import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appSettingsSchema,
  buildRemoteWorkspaceIdentity,
  TID_COMPOSER_WORKSPACE_TRIGGER,
  TID_COMPOSER_REMOTE_CONNECTION,
} from "@zcode/shared";
import {
  buildBaseline,
  launchBaseline,
  closeBaseline,
  enterBaselineUI,
  prepareBaselineLocale,
  desktopRoot,
  repositoryRoot,
  redact,
} from "../../desktop/e2e/runtime.mjs";

const root = await mkdtemp(join(tmpdir(), "zcode-remote-ui-"));
const artifacts = join(desktopRoot, ".e2e-artifacts", `remote-ui-${Date.now()}`);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const environment = process.env.ZCODE_REMOTE_UI_E2E_ENV ?? "test";
assert(["test", "production"].includes(environment));
const version = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).version;
const log = [];
const report = {
  passed: false,
  environment,
  platform: `${process.platform}-${process.arch}`,
  cases: [],
  exits: [],
  limitations: [
    "No real model/Skills/MCP/OAuth or packaged app",
    "Linux only; Renderer command observations are not all-process traffic capture",
  ],
};
let app;
try {
  await buildBaseline(environment);
  report.build = JSON.parse(
    await readFile(join(desktopRoot, ".e2e-cache/baseline-build.json"), "utf8"),
  );
  await prepareBaselineLocale(root);
  const workspacePath = join(root, "local-fixture");
  await mkdir(workspacePath);
  const remote = [
    { kind: "ssh", host: "fixture.invalid", username: "fixture" },
    { kind: "wsl", distro: "fixture" },
    { kind: "docker", container: "fixture" },
  ].map((target) => ({
    kind: "remote",
    workspacePath,
    workspaceIdentity: buildRemoteWorkspaceIdentity(workspacePath, target),
    target,
    lastOpenedAt: 1,
    lastConnectionStatus: "connected",
  }));
  const settingPath = join(root, ".zcode/v2/setting.json");
  await writeFile(
    settingPath,
    JSON.stringify(
      appSettingsSchema.parse({
        locale: "en-US",
        localePreference: "en-US",
        lastWorkspaceSession: [{ kind: "local", workspacePath }, ...remote],
        lastActiveTabIndex: 1,
      }),
    ),
  );
  for (const lifecycle of ["first-start", "restart"]) {
    const launched = await launchBaseline({
      runRoot: root,
      key: "non-credential-fixture",
      log,
      version,
    });
    app = launched.app;
    const page = launched.page;
    await enterBaselineUI(page);
    const trigger = page.getByTestId(TID_COMPOSER_WORKSPACE_TRIGGER);
    await trigger.waitFor();
    await trigger.focus();
    await trigger.press("ArrowDown");
    const history = page.getByTestId("remote-workspace-history-unavailable");
    assert.equal(await history.count(), 3);
    for (const row of await history.all()) {
      assert.equal(await row.getAttribute("aria-disabled"), "true");
      assert.match(await row.innerText(), /Unavailable in this local version/);
    }
    assert.equal(await page.getByTestId(TID_COMPOSER_REMOTE_CONNECTION).count(), 0);
    assert.equal(await page.getByTestId("ssh-dialog").count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "Remote control", exact: true }).count(),
      0,
    );
    await page.screenshot({ path: join(artifacts, `${lifecycle}-history.png`) });
    await page.keyboard.press("Escape");
    await page.getByTestId("workspace-bots-trigger").click();
    await page.getByRole("dialog").waitFor();
    assert.match(await page.getByRole("dialog").innerText(), /Bots/);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    // 明确的本地打开动作通过原平台 native dialog；测试 Main spy 只替换系统选择器返回 fixture。
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, workspacePath);
    await trigger.focus();
    await trigger.press("ArrowDown");
    await page.getByRole("menuitem").filter({ hasText: "Open folder" }).click();
    await trigger.filter({ hasText: "local-fixture" }).waitFor();
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await trigger.focus();
    await trigger.press("ArrowDown");
    await history.first().waitFor();
    assert.equal(await history.count(), 3);
    assert(
      (await page.getByRole("menuitemcheckbox", { name: "local-fixture", exact: true }).count()) >=
        1,
    );
    await page.keyboard.press("Escape");
    report.cases.push(
      `${lifecycle}: unavailable SSH/WSL/Docker history, no wizard/mobile wrapper, local directory open and independent Bots settings reachable`,
    );
    report.exits.push(await closeBaseline(app));
    app = null;
    assert.equal(report.exits.at(-1).code, 0);
    const saved = JSON.parse(await readFile(settingPath, "utf8"));
    assert.deepEqual(
      saved.lastWorkspaceSession.filter((entry) => entry.kind === "remote"),
      remote,
    );
  }
  report.passed = true;
} catch (error) {
  report.failure = redact(error?.stack ?? error);
  if (app) {
    const page = await app.firstWindow();
    report.visibleText = redact(await page.locator("body").innerText());
    await page.screenshot({ path: join(artifacts, "failure.png") });
  }
  throw error;
} finally {
  if (app) {
    try {
      report.exits.push(await closeBaseline(app));
    } catch {}
  }
  await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(artifacts, "runtime.log"), log.map((line) => redact(line)).join("\n"));
  console.log(JSON.stringify({ artifacts, passed: report.passed }));
}
