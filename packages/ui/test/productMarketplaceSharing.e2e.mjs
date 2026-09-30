import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import {
  TID_PLUGIN_STORE_BROWSE,
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_BACK_BUTTON,
  testId,
  PlatformChannels,
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
  waitFor,
} from "../../desktop/e2e/runtime.mjs";

const root = await mkdtemp(join(tmpdir(), "zcode-market-share-ui-"));
const artifacts = join(desktopRoot, ".e2e-artifacts", `market-share-ui-${Date.now()}`);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const version = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).version;
const log = [];
const environment = process.env.ZCODE_MARKET_SHARE_E2E_ENV ?? "test";
assert(["test", "production"].includes(environment));
const report = {
  passed: false,
  environment,
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  cases: [],
  exits: [],
  rendererMarketplaceAssetRequests: [],
  limitations: [
    "No real model credentials, MCP OAuth or packaged app; Linux only",
    "Local fixture and Renderer request counters are not an all-process traffic capture",
  ],
};
let marketRequests = 0;
const server = createServer((_req, res) => {
  marketRequests++;
  res.writeHead(503).end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const source = { source: "url", url: `http://127.0.0.1:${server.address().port}/market.json` };
const configPath = join(root, ".zcode/cli/config.json");
const conversationRoot = join(root, ".zcode/workspace/default");
const shareDirectory = join(conversationRoot, ".zcode-share/old-fixture");
const oldShareFiles = new Map([
  [join(conversationRoot, ".zcode-share-imports.json"), "{}"],
  [
    join(shareDirectory, ".zcode-share-import.json"),
    JSON.stringify({ sessionId: "share-import-old", shareCode: "old-fixture" }),
  ],
  [join(shareDirectory, "fixture.txt"), "retained local attachment"],
]);
let app;
const offlineBuiltinId = "browser-use@zcode-plugins-official";
try {
  await buildBaseline(environment);
  report.buildEvidence = JSON.parse(
    await readFile(join(desktopRoot, ".e2e-cache/baseline-build.json"), "utf8"),
  );
  await prepareBaselineLocale(root);
  await mkdir(join(root, ".zcode/cli"), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({ plugins: { extraKnownMarketplaces: { old: { source } } } }),
  );
  await mkdir(shareDirectory, { recursive: true });
  for (const [path, content] of oldShareFiles) await writeFile(path, content);
  for (const lifecycle of ["first-start", "same-directory-restart"]) {
    const launched = await launchBaseline({
      runRoot: root,
      key: "local-fixture-no-credential",
      log,
      version,
      envPatch: { HOME: root, ZCODE_PRODUCT_PLUGIN_MARKETPLACE_ENABLED: "true" },
    });
    app = launched.app;
    const page = launched.page;
    let shareRequests = 0;
    let marketplaceAssetRequests = 0;
    const marketplaceAssetPattern = "https://cdn-zcode.z.ai/zcode/official-plugin/**";
    // 离线恢复也可能经 img 请求市场 CDN；拦截只防真实下载，请求仍计为失败。
    await page.route(marketplaceAssetPattern, (route) => route.fulfill({ status: 503 }));
    page.on("request", (request) => {
      if (/\/api\/v1\/shares(?:\/|\?|$)/.test(request.url())) shareRequests++;
      if (request.url().startsWith("https://cdn-zcode.z.ai/zcode/official-plugin/"))
        marketplaceAssetRequests++;
    });
    await enterBaselineUI(page);
    await app.evaluate(({ app, BrowserWindow }, channel) => {
      const win = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes("index.html"),
      );
      if (!win) throw Error("application window missing");
      globalThis.__marketShareDeepLinks = 0;
      const send = win.webContents.send.bind(win.webContents);
      win.webContents.send = (name, ...args) => {
        if (name === channel) globalThis.__marketShareDeepLinks++;
        return send(name, ...args);
      };
      app.emit("open-url", { preventDefault() {} }, "zcode://share/import?code=old-fixture");
    }, PlatformChannels.ShareImport);
    await waitFor(
      async () => (await app.evaluate(() => globalThis.__marketShareDeepLinks)) === 1,
      "actual native share intent delivered to disabled Renderer",
    );
    assert.equal(await page.getByTestId("plugin-store-sidebar-open").count(), 0);
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("zcode:open-plugin-store", {
          detail: { intent: "add-marketplace", pluginId: "old@fixture" },
        }),
      ),
    );
    await page.getByTestId(TID_TASK_SETTINGS_BUTTON).click();
    for (const section of ["plugin", "skill", "mcp", "subagents", "modelProvider"]) {
      await page.getByTestId(testId(TID_SETTINGS_SECTION_NAV, section)).click();
      await page.locator(`[data-active-section="${section}"]`).waitFor();
      assert.equal(await page.getByTestId("plugin-store-root").count(), 0);
      assert.equal(await page.getByTestId(TID_PLUGIN_STORE_BROWSE).count(), 0);
      assert.equal(await page.getByTestId("plugin-store-sources-open").count(), 0);
      assert.equal(await page.getByTestId("conversation-share-trigger").count(), 0);
      assert.equal(await page.getByTestId("plugin-store-add-source-menu-item").count(), 0);
      assert(
        !/Browse marketplace|Add marketplace|Recommended plugins/i.test(
          await page.locator("[data-active-section]").innerText(),
        ),
      );
      report.cases.push(
        `${lifecycle}: Independent ${section} settings reachable without marketplace/share UI`,
      );
    }
    await page.getByTestId(testId(TID_SETTINGS_SECTION_NAV, "plugin")).click();
    const builtinRow = page.locator(
      `[data-testid="plugin-settings-plugin-row"][data-plugin-id="${offlineBuiltinId}"]`,
    );
    const restoreButton = page.locator(
      `[data-testid="plugin-settings-restore-builtin"][data-plugin-id="${offlineBuiltinId}"]`,
    );
    const assertOfflineRestoreIcon = async () => {
      const imageSources = await restoreButton
        .locator("..")
        .locator("img")
        .evaluateAll((images) => images.map((image) => image.getAttribute("src")));
      assert(
        imageSources.every((src) => !/^https?:\/\//i.test(src ?? "")),
        "offline restore row must use bundled icons or local fallback, not remote listing.icon",
      );
      assert.equal(marketplaceAssetRequests, 0, "offline restore must not request marketplace CDN");
    };
    if (lifecycle === "first-start") {
      await builtinRow.waitFor();
      await builtinRow.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Uninstall", exact: true }).click();
      await page.getByTestId("plugin-store-uninstall-confirm").click();
      await restoreButton.waitFor();
      assert.equal(await builtinRow.count(), 0);
      await assertOfflineRestoreIcon();
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await restoreButton.waitFor();
      await assertOfflineRestoreIcon();
      assert(
        JSON.parse(await readFile(configPath, "utf8")).plugins.suppressedBuiltins.includes(
          offlineBuiltinId,
        ),
      );
      report.cases.push(
        "uninstall builtin -> local refresh retains offline restore entry and persisted suppression",
      );
    } else {
      await restoreButton.waitFor();
      await assertOfflineRestoreIcon();
      assert.equal(await builtinRow.count(), 0);
      await restoreButton.click();
      await builtinRow.waitFor();
      assert.equal(await restoreButton.count(), 0);
      assert(
        !JSON.parse(await readFile(configPath, "utf8")).plugins.suppressedBuiltins.includes(
          offlineBuiltinId,
        ),
      );
      report.cases.push(
        "normal restart -> offline Plugins restore clears original suppression and builtin reloads",
      );
    }
    await page.getByTestId(TID_SETTINGS_BACK_BUTTON).click();
    assert.equal(await page.getByTestId("plugin-store-root").count(), 0);
    await page.screenshot({ path: join(artifacts, `${lifecycle}-local-ui.png`) });
    report.exits.push(await closeBaseline(app));
    app = undefined;
    report.rendererMarketplaceAssetRequests.push({ lifecycle, count: marketplaceAssetRequests });
    assert.equal(shareRequests, 0);
    assert.equal(marketRequests, 0);
    assert.equal(marketplaceAssetRequests, 0, "Renderer marketplace CDN requests must remain zero");
    assert.deepEqual(
      JSON.parse(await readFile(configPath, "utf8")).plugins.extraKnownMarketplaces.old.source,
      source,
    );
    for (const [path, content] of oldShareFiles)
      assert.equal(await readFile(path, "utf8"), content);
    assert.deepEqual(await readdir(join(conversationRoot, ".zcode-share")), ["old-fixture"]);
    report.cases.push(
      `${lifecycle}: native old share intent creates no import; Renderer share, marketplace CDN and old market fixture requests 0; source declaration and old share marker/index/attachment retained`,
    );
  }
  report.marketRequests = marketRequests;
  report.passed = true;
} catch (error) {
  report.error = redact(error.stack || String(error), "local-fixture-no-credential");
  process.exitCode = 1;
} finally {
  if (app) await closeBaseline(app).catch(() => {});
  server.close();
  await once(server, "close");
  await writeFile(join(artifacts, "runtime.log"), log.join("\n"), { mode: 0o600 });
  await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ artifacts, ...report }, null, 2));
}
