import assert from "node:assert/strict";
import { prepareAccountNativeProbe, assertAccountNativeBoundary } from "./account-native.mjs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TID_LOGIN_TRIGGER,
  TID_LOGIN_MENU_ITEM,
  TID_LOGOUT_BUTTON,
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON,
  TID_MODEL_PROVIDER_TEMPLATE_ITEM,
  TID_MODEL_PROVIDER_API_KEY_INPUT,
  TID_MODEL_PROVIDER_BASE_URL_INPUT,
  TID_SETTINGS_BACK_BUTTON,
  TID_PROJECT_ADD,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_CHAT_MODEL_SELECT_ITEM,
  TID_CHAT_MODEL_SELECT_GROUP,
  testId,
} from "@zcode/shared";
import {
  buildBaseline,
  launchBaseline,
  closeBaseline,
  enterBaselineUI,
  prepareBaselineLocale,
  waitFor,
  desktopRoot,
  repositoryRoot,
  redact,
} from "./runtime.mjs";

// 无真实凭据：只通过 UI 保存隔离的本地配置，不发送模型请求。
const root = await mkdtemp(join(tmpdir(), "zcode-account-ui-"));
const artifacts = join(desktopRoot, ".e2e-artifacts", `account-${Date.now()}`);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const version = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).version;
const key = "local-fixture-no-credential";
const endpoint = "http://127.0.0.1:9/v1";
const log = [];
const environment = process.env.ZCODE_ACCOUNT_E2E_ENV ?? "test";
assert(["test", "production"].includes(environment));
const report = {
  environment,
  platform: `${process.platform}-${process.arch}`,
  passed: false,
  cases: [],
  limitations: ["No external model request or MCP OAuth", "Linux only; development build"],
};
let app;
let page;
let main;
const workspace = join(root, "workspace");
async function openWorkspace() {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, workspace);
  await page.getByTestId(TID_PROJECT_ADD).click();
  await page.getByRole("menuitem", { name: "Open folder", exact: true }).click();
}
async function start() {
  ({ app, page } = await launchBaseline({ runRoot: root, key, log, version, main }));
  await enterBaselineUI(page);
}
async function openModels() {
  await page.getByTestId(TID_TASK_SETTINGS_BUTTON).click();
  await page.getByTestId(testId(TID_SETTINGS_SECTION_NAV, "modelProvider")).click();
}
try {
  await buildBaseline(environment);
  await prepareBaselineLocale(root);
  main = await prepareAccountNativeProbe();
  await start();
  await assertAccountNativeBoundary(app, page);
  report.cases.push(
    "Main native old OAuth/payment/external/webview requests rejected; ordinary MCP/browser URLs preserved",
  );
  await page.getByTestId(TID_LOGIN_TRIGGER).click();
  assert.equal(await page.getByTestId(TID_LOGIN_MENU_ITEM).count(), 0);
  assert.equal(await page.getByTestId(TID_LOGOUT_BUTTON).count(), 0);
  const menu = await page.getByRole("menu").innerText();
  assert(!/Log ?in|Log ?out|Upgrade|Coding Plan|Start Plan|Usage/i.test(menu), menu);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Idle-time task", exact: true }).count(), 0);
  report.cases.push("Real startup and preferences menu: no product account/subscription entry");
  await openModels();
  await page.getByTestId(TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON).click();
  await page.getByTestId(testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, "deepseek")).click();
  const apiKey = page.getByTestId(TID_MODEL_PROVIDER_API_KEY_INPUT);
  await apiKey.fill(key);
  await apiKey.press("Tab");
  await page.getByTestId(TID_MODEL_PROVIDER_BASE_URL_INPUT).fill(endpoint);
  await page.getByTestId(TID_MODEL_PROVIDER_BASE_URL_INPUT).press("Tab");
  const configPath = join(root, ".zcode/v2/provider_config.json");
  await waitFor(async () => {
    const saved = await readFile(configPath, "utf8").catch(() => "");
    return saved.includes(key) && saved.includes(endpoint);
  }, "local API key and endpoint saved via UI");
  assert(
    !/Connect.*account|Log ?in|Start Plan|Team Plan/i.test(
      await page.locator("[data-model-provider-split-panel]").innerText(),
    ),
  );
  await page.screenshot({ path: join(artifacts, "local-model-settings.png") });
  report.cases.push("Local provider created and endpoint/API key persisted through existing UI");
  await page.getByTestId(TID_SETTINGS_BACK_BUTTON).click();
  await mkdir(workspace);
  await openWorkspace();
  await waitFor(
    async () =>
      (await page.getByTestId(TID_CHAT_MODEL_SELECT_TRIGGER).innerText()).includes(
        "deepseek-flash",
      ),
    "local model available in composer",
  );
  await page.getByTestId(TID_CHAT_MODEL_SELECT_TRIGGER).click();
  await page
    .locator(`[data-testid^="${TID_CHAT_MODEL_SELECT_GROUP}"]`)
    .filter({ hasText: "DeepSeek" })
    .hover();
  await page
    .locator(`[data-testid^="${TID_CHAT_MODEL_SELECT_ITEM}"]`)
    .filter({ hasText: "deepseek-v4-pro" })
    .click();
  await waitFor(
    async () =>
      (await page.getByTestId(TID_CHAT_MODEL_SELECT_TRIGGER).innerText()).includes(
        "deepseek-v4-pro",
      ),
    "local model selected through UI",
  );
  assert.equal(await page.getByRole("button", { name: "Idle-time task", exact: true }).count(), 0);
  report.cases.push(
    "Real local workspace composer model menu selects alternate DeepSeek model without login",
  );
  report.exit = await closeBaseline(app);
  app = undefined;
  const credentialsPath = join(root, ".zcode/v2/credentials.json");
  const oldCredentials = JSON.stringify({
    "oauth:active_provider": "bigmodel",
    "oauth:bigmodel:access_token": "expired-fixture-token",
    "oauth:bigmodel:user_info": "corrupt-fixture-profile",
    zcodejwttoken: "expired-fixture-jwt",
    "mcp:fixture": "fixture-mcp-key",
  });
  await writeFile(credentialsPath, oldCredentials, { mode: 0o600 });
  await start();
  await assertAccountNativeBoundary(app, page);
  assert.equal(await readFile(credentialsPath, "utf8"), oldCredentials);
  report.cases.push(
    "Legacy expired account credentials survive startup and native bypass unchanged",
  );
  // 冷启动回到既有空新任务；显式重新打开相同本地 workspace 再验证草稿选择。
  await openWorkspace();
  await waitFor(
    async () =>
      (await page.getByTestId(TID_CHAT_MODEL_SELECT_TRIGGER).innerText()).includes(
        "deepseek-v4-pro",
      ),
    "selected local model restored after restart",
  );
  report.cases.push("Selected local model survives restart");
  await openModels();
  await page.getByRole("button", { name: /DeepSeek/ }).click();
  assert.equal(await page.getByTestId(TID_MODEL_PROVIDER_API_KEY_INPUT).inputValue(), key);
  assert.equal(await page.getByTestId(TID_MODEL_PROVIDER_BASE_URL_INPUT).inputValue(), endpoint);
  assert(
    (await page.locator("[data-model-provider-split-panel]").innerText()).includes(
      "deepseek-flash",
    ),
  );
  report.cases.push("Restart restores saved local endpoint/API key and model list");
  report.restartExit = await closeBaseline(app);
  app = undefined;
  assert.equal(await readFile(credentialsPath, "utf8"), oldCredentials);
  report.passed = true;
} catch (error) {
  report.error = redact(error.stack ?? error, key);
  if (page)
    await writeFile(
      join(artifacts, "failure-ui.txt"),
      redact(
        await page
          .locator("body")
          .innerText()
          .catch(() => ""),
        key,
      ),
    );
  process.exitCode = 1;
} finally {
  if (app)
    await closeBaseline(app).catch((error) => {
      report.cleanupError = redact(error.message, key);
    });
  await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(artifacts, "runtime.log"), redact(log.join(""), key));
  console.info(
    JSON.stringify(
      { artifacts, passed: report.passed, cases: report.cases, error: report.error },
      null,
      2,
    ),
  );
}
