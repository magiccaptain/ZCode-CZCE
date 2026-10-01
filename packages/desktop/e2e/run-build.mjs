import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  appSettingsSchema,
  buildRemoteWorkspaceIdentity,
  PlatformChannels,
  TID_COMPOSER_WORKSPACE_TRIGGER,
  TID_COMPOSER_REMOTE_CONNECTION,
  TID_LOGIN_TRIGGER,
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_BACK_BUTTON,
  testId,
} from "@zcode/shared";
import {
  launchBaseline,
  closeBaseline,
  enterBaselineUI,
  desktopRoot,
  repositoryRoot,
  redact,
} from "./runtime.mjs";

// 只运行已构建的安装包，不重建或替换包内 Agent，不注入业务状态桥。
const { values } = parseArgs({ options: { executable: { type: "string" } } });
assert(values.executable, "Pass --executable pointing to the current packaged Desktop");
const executablePath = resolve(values.executable);
const root = await mkdtemp(join(tmpdir(), "zcode-build-smoke-"));
const artifacts = join(desktopRoot, ".e2e-artifacts", `build-${Date.now()}`);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const workspacePath = join(root, "workspace");
await mkdir(workspacePath);
const version = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).version;
const targets = [
  { kind: "ssh", host: "fixture.invalid", username: "fixture" },
  { kind: "wsl", distro: "fixture" },
  { kind: "docker", container: "fixture" },
];
const history = targets.map((target) => ({
  kind: "remote",
  workspacePath,
  workspaceIdentity: buildRemoteWorkspaceIdentity(workspacePath, target),
  target,
  lastOpenedAt: 1,
  lastConnectionStatus: "connected",
}));
let marketRequests = 0;
const trap = createServer((_request, response) => {
  marketRequests++;
  response.writeHead(503).end();
});
await new Promise((done) => trap.listen(0, "127.0.0.1", done));
const source = { source: "url", url: `http://127.0.0.1:${trap.address().port}/market.json` };
const settingsPath = join(root, ".zcode/v2/setting.json");
const configPath = join(root, ".zcode/cli/config.json");
const credentialsPath = join(root, ".zcode/v2/credentials.json");
const credentials = JSON.stringify({
  "oauth:active_provider": "bigmodel",
  "oauth:bigmodel:access_token": "expired-fixture-token",
  "oauth:bigmodel:user_info": "corrupt-fixture-profile",
  zcodejwttoken: "expired-fixture-jwt",
  "mcp:fixture": "non-credential-fixture",
});
const shareDirectory = join(workspacePath, ".zcode-share/old-fixture");
const files = new Map([
  [credentialsPath, credentials],
  [join(workspacePath, ".zcode-share-imports.json"), "{}"],
  [
    join(shareDirectory, ".zcode-share-import.json"),
    JSON.stringify({ sessionId: "old", shareCode: "old-fixture" }),
  ],
  [join(shareDirectory, "fixture.txt"), "retained local attachment"],
]);
const report = {
  passed: false,
  packaged: true,
  platform: `${process.platform}-${process.arch}`,
  executablePath,
  cases: [],
  limitations: [
    "Chromium netlog and local fixture counters are not all-process traffic capture",
    "Package has no Host RPC or IPC Promise bypass probe; those guards are covered by existing component/development tests",
    "No model/Skills/MCP execution in this smoke; separate real core and packaged model runners cover them",
    "No phone pairing owner exists in this checkout; no invented pairing execution test",
    "Linux only; no Windows/macOS, signatures or OS-level installation",
  ],
};
let app;
try {
  await mkdir(join(root, ".zcode/v2"), { recursive: true });
  await mkdir(join(root, ".zcode/cli"), { recursive: true });
  await mkdir(shareDirectory, { recursive: true });
  await writeFile(
    settingsPath,
    JSON.stringify(
      appSettingsSchema.parse({
        locale: "en-US",
        localePreference: "en-US",
        lastWorkspaceSession: [{ kind: "local", workspacePath }, ...history],
        lastActiveTabIndex: 1,
        autoDownloadAndInstallUpdates: true,
        receivePreviewUpdates: true,
      }),
    ),
  );
  await writeFile(
    configPath,
    JSON.stringify({ plugins: { extraKnownMarketplaces: { old: { source } } } }),
  );
  for (const [path, bytes] of files) await writeFile(path, bytes, { mode: 0o600 });
  for (const lifecycle of ["first-start", "restart"]) {
    const log = [];
    const netlogPath = join(root, `${lifecycle}-netlog.json`);
    try {
      const launched = await launchBaseline({
        runRoot: root,
        key: "non-credential-fixture",
        log,
        version,
        executablePath,
        extraArgs: [`--log-net-log=${netlogPath}`, "--net-log-capture-mode=Default"],
        envPatch: {
          HOME: root,
          ZCODE_PRODUCT_PLUGIN_MARKETPLACE_ENABLED: "true",
          ZCODE_AUTO_UPDATE_DEV: "1",
        },
      });
      app = launched.app;
      const page = launched.page;
      assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
      await enterBaselineUI(page);
      const capabilities = await page.evaluate(() => window.zcode.productCapabilities);
      for (const name of [
        "webProduct",
        "appUpdates",
        "productAccount",
        "productSubscription",
        "pluginMarketplace",
        "sharing",
        "telemetry",
        "remoteWorkspaces",
        "mobileRemoteControl",
      ])
        assert.equal(capabilities[name], false, name);
      const refusal = await page.evaluate(
        async ({ targets, workspacePath }) => ({
          connections: await Promise.all(
            targets.map((target) =>
              window.zcode.connectRemote(target, "old", {
                workspacePath,
                connectTrigger: "restore",
              }),
            ),
          ),
          bind: await window.zcode
            .bindRemoteWorkspaceSessionContext({ remoteSessionId: "old", workspacePath })
            .then(
              () => "unexpected-success",
              (error) => error.message,
            ),
          discovery: [
            await window.zcode.isDockerAvailable(),
            await window.zcode.listWSLDistros(),
            await window.zcode.listDockerContainers(),
            await window.zcode.listSSHConfigAliases(),
          ],
          update: await window.zcode.getUpdateState(),
        }),
        { targets, workspacePath },
      );
      assert(
        refusal.connections.every(
          (result) =>
            result.success === false && /REMOTE_WORKSPACES_UNAVAILABLE/.test(result.error),
        ),
      );
      assert.match(refusal.bind, /REMOTE_WORKSPACES_UNAVAILABLE/);
      assert.deepEqual(refusal.discovery, [false, [], [], []]);
      assert.deepEqual(refusal.update, { kind: "idle", enabled: false });
      // 观察真实 Main 深链的输出，不替换执行 guard 或 shell/network。
      await app.evaluate(({ app, BrowserWindow, ipcMain }, channels) => {
        const win = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().includes("index.html"),
        );
        if (!win) throw Error("packaged application window missing");
        const counts = (globalThis.__buildSmokeCallbacks = { account: 0, share: 0 });
        const send = win.webContents.send.bind(win.webContents);
        win.webContents.send = (channel, ...args) => {
          if ([channels.OAuthCallback, channels.PaymentCallback].includes(channel))
            counts.account++;
          if (channel === channels.ShareImport) counts.share++;
          return send(channel, ...args);
        };
        ipcMain.emit(
          channels.OAuthRegisterState,
          { sender: win.webContents },
          { state: "old-fixture-state" },
        );
        for (const url of [
          "zcode://oauth/callback?state=old-fixture-state&code=fixture",
          "zcode://payment/callback?order=fixture",
          "zcode://share/import?code=old-fixture",
        ])
          app.emit("open-url", { preventDefault() {} }, url);
      }, PlatformChannels);
      assert.deepEqual(await app.evaluate(() => globalThis.__buildSmokeCallbacks), {
        account: 0,
        share: 1,
      });
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("zcode:open-plugin-store", { detail: { intent: "add-marketplace" } }),
        ),
      );
      const trigger = page.getByTestId(TID_COMPOSER_WORKSPACE_TRIGGER);
      await trigger.focus();
      await trigger.press("ArrowDown");
      const rows = page.getByTestId("remote-workspace-history-unavailable");
      assert.equal(await rows.count(), 3);
      for (const row of await rows.all())
        assert.equal(await row.getAttribute("aria-disabled"), "true");
      assert.equal(await page.getByTestId(TID_COMPOSER_REMOTE_CONNECTION).count(), 0);
      await page.keyboard.press("Escape");
      await page.getByTestId(TID_LOGIN_TRIGGER).click();
      assert(
        !/Log ?in|Log ?out|Upgrade|Coding Plan|Start Plan|Usage/i.test(
          await page.getByRole("menu").innerText(),
        ),
      );
      await page.keyboard.press("Escape");
      await page.getByTestId(TID_TASK_SETTINGS_BUTTON).click();
      for (const section of ["plugin", "skill", "mcp", "subagents", "modelProvider"]) {
        await page.getByTestId(testId(TID_SETTINGS_SECTION_NAV, section)).click();
        await page.locator(`[data-active-section="${section}"]`).waitFor();
        for (const id of [
          "plugin-store-root",
          "plugin-store-sidebar-open",
          "plugin-store-sources-open",
          "conversation-share-trigger",
          "plugin-store-add-source-menu-item",
        ])
          assert.equal(await page.getByTestId(id).count(), 0, id);
        assert(
          !/Browse marketplace|Add marketplace|Recommended plugins|Connect.*account|Start Plan|Team Plan/i.test(
            await page.locator("[data-active-section]").innerText(),
          ),
        );
      }
      await page.getByTestId(TID_SETTINGS_BACK_BUTTON).click();
      assert.equal(
        await page.getByRole("button", { name: "Remote control", exact: true }).count(),
        0,
      );
      await page.screenshot({ path: join(artifacts, `${lifecycle}.png`) });
      const exit = await closeBaseline(app);
      app = null;
      for (const [path, bytes] of files) assert.equal(await readFile(path, "utf8"), bytes);
      const saved = JSON.parse(await readFile(settingsPath, "utf8"));
      assert.deepEqual(
        saved.lastWorkspaceSession.filter((entry) => entry.kind === "remote"),
        history,
      );
      assert.deepEqual(
        JSON.parse(await readFile(configPath, "utf8")).plugins.extraKnownMarketplaces.old.source,
        source,
      );
      assert.deepEqual(await readdir(join(workspacePath, ".zcode-share")), ["old-fixture"]);
      const netlog = JSON.parse(await readFile(netlogPath, "utf8"));
      assert(netlog.events.length > 0);
      const productRequests = netlog.events.filter((event) =>
        /\/event\/report(?:\?|$)|rum.*log|log.*aliyuncs|\/api\/v1\/shares(?:\/|\?|$)|\/official-plugin\/|\/oauth\/authorize|\/coding-plan|\/relay(?:\/|\?|$)/i.test(
          event.params?.url ?? "",
        ),
      );
      assert.equal(productRequests.length, 0);
      assert.equal(marketRequests, 0);
      assert(
        !log.some((line) =>
          /\[arms\] electron initialized|\[network\] reporting started|\[resource\] sampling started/.test(
            line,
          ),
        ),
      );
      report.cases.push({
        lifecycle,
        oldDataPreserved: true,
        preloadRefusal: true,
        nativeAccountCallbacks: 0,
        disabledShareIntentDelivered: 1,
        marketRequests,
        productRequests: 0,
        networkEvents: netlog.events.length,
        exitCode: exit.code,
      });
    } finally {
      if (app) await closeBaseline(app).catch(() => {});
      app = null;
      await writeFile(join(artifacts, `${lifecycle}-runtime.log`), log.join(""));
    }
  }
  report.passed = true;
} catch (error) {
  report.failure = redact(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  await new Promise((done) => trap.close(done));
  await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Packaged build evidence: ${join(artifacts, "report.json")}`);
  if (report.failure) console.error(report.failure);
}
