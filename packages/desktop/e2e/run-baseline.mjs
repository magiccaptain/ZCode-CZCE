import { prepareExtensions } from "./extensions.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify, parseArgs } from "node:util";
import {
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON,
  TID_MODEL_PROVIDER_API_KEY_INPUT,
  TID_MODEL_PROVIDER_TEMPLATE_ITEM,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
  TID_V4_STOP,
  TID_V4_TIMELINE,
  TID_V4_QUEUE_ITEM,
  TID_PROJECT_ADD,
  TID_TASK_ITEM,
  testId,
} from "@zcode/shared";
import {
  buildBaseline,
  closeBaseline,
  desktopRoot,
  launchBaseline,
  enterBaselineUI,
  redact,
  repositoryRoot,
  waitFor,
} from "./runtime.mjs";
import { inspectPersistence } from "./persistence.mjs";

const execute = promisify(execFile);
const { stdout: pnpmVersion } = await execute("pnpm", ["--version"], {
  shell: process.platform === "win32",
});
assert.equal(pnpmVersion.trim(), "10.33.2", "Use pnpm 10.33.2 (see mise.toml)");
const { values } = parseArgs({
  options: {
    "key-file": { type: "string" },
    extensions: { type: "boolean", default: false },
  },
});
assert(values["key-file"], "Pass --key-file pointing to a private file outside the repository");
assert.equal(process.version, "v24.14.0", "Use Node 24.14.0 (see mise.toml)");
const keyFile = resolve(values["key-file"]);
const keyRelativePath = relative(repositoryRoot, keyFile);
assert(
  keyRelativePath.startsWith(`..${sep}`) || isAbsolute(keyRelativePath),
  "Keep credentials outside the repository",
);
const key = (await readFile(keyFile, "utf8")).trim();
assert(key && !/\s/.test(key), "Key file must contain only the API key");

const id = randomUUID();
const token = id.replaceAll("-", "").slice(0, 10);
const marker = (name) => `BASELINE_${name}_${token}`;
const runRoot = await mkdtemp(join(tmpdir(), "zcode-desktop-baseline-"));
await chmod(runRoot, 0o700);
const workspace = join(runRoot, "workspace");
const artifacts = join(desktopRoot, ".e2e-artifacts", id);
await mkdir(workspace);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
await copyFile(join(import.meta.dirname, "gated-tool.mjs"), join(workspace, "gated-tool.mjs"));
const rootPackage = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const { stdout: commit } = await execute("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
const { stdout: status } = await execute("git", ["status", "--short"], { cwd: repositoryRoot });
const log = [];
const report = {
  runId: id,
  startedAt: new Date().toISOString(),
  commit: commit.trim(),
  sourceStatus: status.trim(),
  node: process.version,
  pnpm: pnpmVersion.trim(),
  platform: `${process.platform}-${process.arch}`,
  version: rootPackage.version,
  build: "fresh baseline build",
  environment: "test",
  productFlavor: "preview",
  model: "DeepSeek/deepseek-flash",
  runRoot,
  workspace,
  sessionId: null,
  stages: [],
  passed: false,
  scope: values.extensions
    ? "local core plus user/workspace Skills and stdio/authenticated HTTP MCP; no cross-Host/mobile/installed package coverage"
    : "local core; no update shutdown, cross-Host/mobile/Skills/MCP/installed package coverage",
};
let app;
let page;
let credentialInputActive = false;
const extensions = values.extensions
  ? await prepareExtensions({ runRoot, workspace, marker })
  : null;

async function persistReport() {
  await writeFile(join(artifacts, "report.json"), redact(JSON.stringify(report, null, 2), key));
  await writeFile(join(artifacts, "runtime.log"), redact(log.join(""), key));
}

async function stage(name, action) {
  const entry = { name, startedAt: new Date().toISOString(), status: "running" };
  report.stages.push(entry);
  console.log(`[baseline] ${name}`);
  try {
    const details = await action();
    entry.status = "passed";
    entry.details = details;
    if (page && !page.isClosed() && !credentialInputActive) {
      await page.screenshot({ path: join(artifacts, `${report.stages.length}-${name}.png`) });
    }
  } catch (error) {
    entry.status = "failed";
    entry.error = redact(error.stack ?? error, key);
    if (page && !page.isClosed() && !credentialInputActive) {
      await page.screenshot({
        path: join(artifacts, `${report.stages.length}-${name}-failed.png`),
      });
      await writeFile(
        join(artifacts, "failure-ui.txt"),
        redact(await page.locator("body").innerText(), key),
      );
    }
    throw error;
  } finally {
    entry.finishedAt = new Date().toISOString();
    await persistReport();
  }
}

async function start() {
  ({ app, page } = await launchBaseline({
    runRoot,
    key,
    log,
    version: rootPackage.version,
    envPatch: extensions ? { HOME: runRoot } : {},
  }));
}

async function send(text) {
  const before = await page.evaluate(() => window.__zcodeV4CommandAcksE2E?.at(-1)?.at ?? 0);
  const draft =
    (await page.locator("[data-session-id]").getAttribute("data-session-id")) === "draft";
  // 无附件的首发可由 createSession(firstInput) 原子 admission；已有会话走 sendText。
  // 两条路径都是当前 UI/Runtime 契约，不能把首发缺少 sendText ACK 当作发送失败。
  const types = draft ? ["createSession", "sendText"] : ["sendText"];
  await page.getByTestId(TID_V4_COMPOSER_INPUT).fill(text);
  await page.getByTestId(TID_V4_COMPOSER_SEND).click();
  await page.waitForFunction(
    ({ since, types }) =>
      window.__zcodeV4CommandAcksE2E?.some((ack) => ack.at > since && types.includes(ack.type)),
    { since: before, types },
    { timeout: 30_000 },
  );
  const ack = await page.evaluate(
    (types) => window.__zcodeV4CommandAcksE2E.filter((entry) => types.includes(entry.type)).at(-1),
    types,
  );
  assert.equal(ack.status, "accepted", JSON.stringify(ack));
  return ack;
}

async function completed(expected) {
  // 限定独立文本节点，避免用户提示词中的同一标记让模型回复断言提前通过。
  await page
    .getByTestId(TID_V4_TIMELINE)
    .getByText(expected, { exact: true })
    .waitFor({ timeout: 120_000 });
  await page.getByTestId(TID_V4_STOP).waitFor({ state: "hidden", timeout: 120_000 });
}

async function permission(kind) {
  const option = page.locator(`[data-permission-option-kind="${kind}"]`);
  await option.waitFor({ timeout: 120_000 });
  await option.focus();
  await option.press("Enter");
  await option.waitFor({ state: "hidden" });
}

async function contents(name) {
  try {
    return await readFile(join(workspace, name), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

try {
  await stage("build", async () => {
    await buildBaseline();
    const stamp = JSON.parse(
      await readFile(join(desktopRoot, ".e2e-cache/baseline-build.json"), "utf8"),
    );
    assert.equal(stamp.node, process.version);
    report.buildEvidence = stamp;
  });
  await stage("startup", async () => {
    await start();
    await enterBaselineUI(page);
    return { accountLogin: false, normalDesktopUI: true };
  });
  await stage("provider", async () => {
    credentialInputActive = true;
    await page.getByTestId(TID_TASK_SETTINGS_BUTTON).click();
    await page.getByTestId(testId(TID_SETTINGS_SECTION_NAV, "modelProvider")).click();
    await page.getByTestId(TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON).click();
    await page.getByTestId(testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, "deepseek")).click();
    const input = page.getByTestId(TID_MODEL_PROVIDER_API_KEY_INPUT);
    await input.fill(key);
    await input.press("Tab");
    await waitFor(async () => {
      const config = await readFile(join(runRoot, ".zcode/v2/provider_config.json"), "utf8").catch(
        (error) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      );
      return config.includes(key);
    }, "Provider key persisted through UI");
    await page.getByTestId(TID_SETTINGS_BACK_BUTTON).click();
    await page.getByTestId(TID_V4_COMPOSER_INPUT).waitFor();
    credentialInputActive = false;
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, workspace);
    await page.getByTestId(TID_PROJECT_ADD).click();
    await page.getByRole("menuitem", { name: "Open folder", exact: true }).click();
    await waitFor(
      async () =>
        (await page.getByTestId(TID_CHAT_MODEL_SELECT_TRIGGER).innerText()).includes(
          "deepseek-flash",
        ),
      "DeepSeek selected in workspace",
    );
    return {
      provider: "deepseek",
      model: "deepseek-flash",
      apiFormat: "template default",
      keyPersisted: true,
    };
  });
  await stage("dialogue", async () => {
    await send(`Reply with exactly ${marker("HELLO")}. Do not use tools.`);
    await completed(marker("HELLO"));
    report.sessionId = await page.locator("[data-session-id]").getAttribute("data-session-id");
    assert(report.sessionId && report.sessionId !== "draft");
    await access(join(runRoot, "agent-storage/session.sqlite"));
    return { sessionId: report.sessionId, isolatedAgentDatabase: true };
  });
  await stage("tools", async () => {
    await send(
      `Use only bash to run exactly: printf ${marker("TOOL")} > tool-result.txt && cat tool-result.txt. After success reply exactly ${marker("TOOL_DONE")}.`,
    );
    await permission("allowOnce");
    await completed(marker("TOOL_DONE"));
    assert.equal(await contents("tool-result.txt"), marker("TOOL"));
    return { fileContent: marker("TOOL"), readBack: true, permission: "allowOnce" };
  });
  await stage("permission-deny", async () => {
    await send(
      `Use only bash to run exactly: printf ${marker("PERMISSION")} > permission-result.txt. If permission is denied do not retry or use another tool, reply exactly ${marker("DENIED")}.`,
    );
    await permission("rejectOnce");
    await completed(marker("DENIED"));
    assert.equal(await contents("permission-result.txt"), null);
    return { answer: "rejectOnce", targetFileAbsent: true };
  });
  await stage("permission-allow", async () => {
    await send(
      `Retry the exact bash command now: printf ${marker("PERMISSION")} > permission-result.txt. Request permission again. After success reply exactly ${marker("ALLOWED")}.`,
    );
    await permission("allowOnce");
    await completed(marker("ALLOWED"));
    assert.equal(await contents("permission-result.txt"), marker("PERMISSION"));
    return { answer: "allowOnce", fileContent: marker("PERMISSION") };
  });
  await stage("busy-followup", async () => {
    await send(
      `Use only bash to run exactly: node gated-tool.mjs busy ${marker("BUSY")}. Keep it in the foreground. Do not edit the script or create any release file; the test runner will release it. After success reply exactly ${marker("BUSY_DONE")}.`,
    );
    await permission("allowOnce");
    await waitFor(
      async () => (await contents("busy-started.txt")) === marker("BUSY"),
      "real tool running",
    );
    assert(await page.getByTestId(TID_V4_STOP).isVisible());
    const ack = await send(
      `After the current command finishes, use only bash to run exactly: printf ${marker("FOLLOWUP")} >> followup-result.txt. After success reply exactly ${marker("FOLLOWUP_DONE")}.`,
    );
    await page
      .locator(`[data-testid^="${TID_V4_QUEUE_ITEM}-"]`)
      .filter({ hasText: marker("FOLLOWUP") })
      .waitFor();
    assert.equal(await contents("followup-result.txt"), null);
    assert.equal(await contents("busy-completed.txt"), null);
    await page.screenshot({ path: join(artifacts, "busy-queued.png") });
    await writeFile(join(workspace, "busy-release.txt"), "release");
    await permission("allowOnce");
    await completed(marker("FOLLOWUP_DONE"));
    assert.equal(await contents("busy-completed.txt"), marker("BUSY"));
    assert.equal(await contents("busy-invocations.txt"), `${marker("BUSY")}\n`);
    assert.equal(await contents("followup-result.txt"), marker("FOLLOWUP"));
    return { acceptedWhileRunning: true, ack, queuedBeforeRelease: true, executions: 1 };
  });
  await stage("stop", async () => {
    await send(
      `Use only bash to run exactly: node gated-tool.mjs stop ${marker("STOP")}. Keep it in the foreground. Do not edit the script or create release files. After success reply exactly ${marker("STOP_DONE")}.`,
    );
    await permission("allowOnce");
    await waitFor(
      async () => (await contents("stop-started.txt")) === marker("STOP"),
      "stop target running",
    );
    await page.getByTestId(TID_V4_STOP).click();
    await page.getByTestId(TID_V4_STOP).waitFor({ state: "hidden", timeout: 30_000 });
    await writeFile(join(workspace, "stop-release.txt"), "release");
    await send(
      `Do not resume any previous command. Do not use tools. Reply with exactly ${marker("AFTER_STOP")}.`,
    );
    await completed(marker("AFTER_STOP"));
    assert.equal(await contents("stop-completed.txt"), null);
    assert.equal(await contents("stop-invocations.txt"), `${marker("STOP")}\n`);
    assert.equal(
      await page
        .getByTestId(TID_V4_TIMELINE)
        .getByText(marker("STOP_DONE"), { exact: true })
        .count(),
      0,
    );
    return { stoppedWhileToolRunning: true, noLateCompletion: true, nextTurnPassed: true };
  });
  await stage("restart", async () => {
    const exit = await closeBaseline(app);
    app = undefined;
    page = undefined;
    await start();
    await page.getByTestId(testId(TID_TASK_ITEM, report.sessionId)).click();
    await page.locator(`[data-session-id="${report.sessionId}"]`).waitFor();
    await completed(marker("AFTER_STOP"));
    await page
      .getByTestId(TID_V4_TIMELINE)
      .getByText(marker("FOLLOWUP_DONE"), { exact: true })
      .waitFor();
    await send(`Do not use tools. Reply with exactly ${marker("RECOVERED")}.`);
    await completed(marker("RECOVERED"));
    assert.equal(await contents("stop-completed.txt"), null);
    assert.equal(await contents("tool-result.txt"), marker("TOOL"));
    return { exit, sameSession: true, historyRestored: true, continuedDialogue: true };
  });
  if (extensions) {
    await stage("skills-mcp", async () => {
      const result = await extensions.runSession({ page, send, completed });
      report.extensionsSessionId = result.sessionId;
      return result;
    });
  }
  await stage("shutdown", async () => {
    const exit = await closeBaseline(app);
    app = undefined;
    page = undefined;
    return exit;
  });
  await stage("persistence", async () =>
    inspectPersistence({
      databasePath: join(runRoot, "agent-storage/session.sqlite"),
      sessionId: report.sessionId,
      token,
      workspace,
    }),
  );
  if (extensions)
    await stage("extensions-persistence", () =>
      extensions.verify(join(runRoot, "agent-storage/session.sqlite"), report.extensionsSessionId),
    );
  report.passed = true;
} catch (error) {
  console.error(`[baseline] FAILED: ${redact(error.message, key)}`);
  process.exitCode = 1;
} finally {
  if (app) {
    try {
      report.cleanupExit = await closeBaseline(app);
    } catch (error) {
      report.cleanupError = redact(error.message, key);
      report.passed = false;
      process.exitCode = 1;
    }
  }
  if (extensions) await extensions.close();
  report.finishedAt = new Date().toISOString();
  await persistReport();
  console.log(
    `[baseline] ${report.passed ? "PASSED" : "FAILED"}; report: ${join(artifacts, "report.json")}`,
  );
  console.log(`[baseline] Private test data retained at ${runRoot}`);
}
