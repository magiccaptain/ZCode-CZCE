import { runPackagedAgentSmoke, inspectPackagedAgentSmoke } from "./packaged-smoke.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import {
  DesktopCommandIds,
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  testId,
} from "@zcode/shared";
import {
  buildBaseline,
  closeBaseline,
  launchBaseline,
  enterBaselineUI,
  desktopRoot,
  repositoryRoot,
  redact,
} from "./runtime.mjs";

const { values } = parseArgs({
  options: { executable: { type: "string" }, "key-file": { type: "string" } },
});
if (values["key-file"]) {
  const keyRelative = relative(repositoryRoot, resolve(values["key-file"]));
  assert(
    keyRelative.startsWith(`..${sep}`) || isAbsolute(keyRelative),
    "credentials must remain outside the repository",
  );
}
const key = values["key-file"]
  ? (await readFile(values["key-file"], "utf8")).trim()
  : "no-secret-used";
assert(!values["key-file"] || values.executable, "model smoke requires a packaged executable");
const require = createRequire(join(desktopRoot, "package.json"));
const { sanitizeFileName } = require("builder-util/out/filename.js");
const oldCacheName =
  sanitizeFileName(
    JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8")).name,
  ).toLowerCase() + "-updater";
const version = JSON.parse(await readFile(join(repositoryRoot, "package.json"))).version;
const root = await mkdtemp(join(tmpdir(), "zcode-updates-"));
const artifactDir = join(desktopRoot, ".e2e-artifacts", `updates-${Date.now()}`);
await mkdir(artifactDir, { recursive: true, mode: 0o700 });
const report = {
  startedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  packaged: Boolean(values.executable),
  cases: [],
  passed: false,
};
let trapRequests = 0;
const trap = createServer((_req, res) => {
  trapRequests++;
  res.writeHead(500);
  res.end();
});
await new Promise((resolve) => trap.listen(0, "127.0.0.1", resolve));
const feed = `http://127.0.0.1:${trap.address().port}`;

try {
  for (const environment of values.executable ? ["packaged"] : ["production", "test"]) {
    if (!values.executable) await buildBaseline(environment);
    for (const legacy of [false, true]) {
      const runRoot = join(root, `${environment}-${legacy ? "legacy" : "clean"}`);
      await mkdir(runRoot, { mode: 0o700 });
      const settingsPath = join(runRoot, ".zcode/v2/setting.json");
      const pending = {
        version: "999.0.0",
        title: "OLD_UPDATE_MARKER",
        markdown: "OLD_UPDATE_MARKER",
      };
      if (legacy) {
        await mkdir(join(runRoot, ".zcode/v2"), { recursive: true });
        await writeFile(
          settingsPath,
          JSON.stringify({
            autoDownloadAndInstallUpdates: true,
            receivePreviewUpdates: true,
            pendingPostUpdateReleaseNotes: pending,
          }),
        );
        // 与当前 electron-updater 的 Linux cache owner 和 builder cache 名称一致。
        for (const cacheName of [oldCacheName, `ZCode Baseline ${runRoot.split(/[\\/]/).at(-1)}`]) {
          const pendingDir = join(runRoot, ".cache", cacheName, "pending");
          await mkdir(pendingDir, { recursive: true });
          await writeFile(
            join(pendingDir, "update-info.json"),
            JSON.stringify({
              fileName: "old-installer.AppImage",
              sha512: "old-cache-marker",
              isAdminRightsRequired: false,
            }),
          );
          await writeFile(
            join(pendingDir, "old-installer.AppImage"),
            "OLD_DOWNLOADED_PACKAGE_MARKER",
          );
        }
      }
      // 在 Main 加载前观察真实更新器和 Electron net，保留其他产品请求的原执行路径。
      const bootstrap = join(desktopRoot, ".e2e-cache", `updates-bootstrap-${environment}.mjs`);
      await mkdir(join(desktopRoot, ".e2e-cache"), { recursive: true });
      await writeFile(
        bootstrap,
        `
import { net } from 'electron';
import pkg from ${JSON.stringify(pathToFileURL(require.resolve("electron-updater")).href)};
const probe = globalThis.__updateProbe = { calls: [], forceRequests: 0 };
const updater = pkg.autoUpdater;
for (const name of ['checkForUpdates', 'downloadUpdate', 'quitAndInstall']) {
  updater[name] = () => { probe.calls.push(name); throw new Error('unexpected updater call'); };
}
const request = net.request.bind(net);
net.request = (...args) => {
  const value = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  if (value && /client\\/configs.*app_version=/.test(value) && /fetchRemoteForceUpdateConfig|resolveDesktopForceUpdateRequirement/.test(new Error().stack ?? "")) probe.forceRequests++;
  return request(...args);
};
probe.updater = updater;
await import(${JSON.stringify(pathToFileURL(join(desktopRoot, "out/main/index.js")).href)});
`,
      );
      const log = [];
      const launchOptions = {
        runRoot,
        key,
        log,
        version,
        main: bootstrap,
        executablePath: values.executable,
        extraArgs: values.executable
          ? [`--log-net-log=${join(runRoot, "netlog.json")}`, "--net-log-capture-mode=Default"]
          : [],
        envPatch: { HOME: runRoot, ZCODE_AUTO_UPDATE_DEV: "1", ZCODE_UPDATE_FEED_URL: feed },
      };
      const { app, page } = await launchBaseline(launchOptions);
      const child = app.process();
      try {
        assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(values.executable));
        await enterBaselineUI(page);
        const capabilities = await page.evaluate(() => window.zcode.productCapabilities);
        assert.equal(capabilities.appUpdates, false);
        assert.deepEqual(await page.evaluate(() => window.zcode.getUpdateState()), {
          kind: "idle",
          enabled: false,
        });
        assert.deepEqual(await page.evaluate(() => window.zcode.getAutoUpdatePreferences()), {
          autoDownloadAndInstallUpdates: false,
        });
        const rejected = await page.evaluate(async (command) => {
          const operations = [
            () => window.zcode.executeDesktopCommand(command),
            () => window.zcode.downloadUpdate(),
            () => window.zcode.cancelUpdateDownload(),
            () => window.zcode.quitAndInstallUpdate(),
            () => window.zcode.skipUpdateVersion("999.0.0"),
            () => window.zcode.setAutoDownloadAndInstallUpdates(true),
            () => window.zcode.openUpdateStatusWindow(),
            () => window.zcode.acknowledgePostUpdateReleaseNotes("999.0.0"),
          ];
          return Promise.all(
            operations.map(async (op) => {
              try {
                await op();
                return "unexpected success";
              } catch (error) {
                return String(error);
              }
            }),
          );
        }, DesktopCommandIds.CheckForUpdates);
        for (const error of rejected) assert.match(error, /APP_UPDATES_UNAVAILABLE/);
        const menu = await app.evaluate(({ Menu }) => {
          const items = [];
          const visit = (menu) =>
            menu?.items.forEach((item) => {
              items.push({ id: item.id, label: item.label });
              visit(item.submenu);
            });
          visit(Menu.getApplicationMenu());
          return items;
        });
        assert(!menu.some((item) => item.id === "check-for-update"));
        await page.getByTestId(TID_TASK_SETTINGS_BUTTON).click();
        await page.getByTestId(testId(TID_SETTINGS_SECTION_NAV, "general")).click();
        assert.equal(
          await page
            .getByRole("switch", {
              name: /preview updates|automatically download|automatic updates/i,
            })
            .count(),
          0,
        );
        assert.equal(await page.getByText("OLD_UPDATE_MARKER", { exact: true }).count(), 0);
        await page.screenshot({
          path: join(artifactDir, `${environment}-${legacy ? "legacy" : "clean"}.png`),
        });
        const smoke =
          values.executable && values["key-file"] && !legacy
            ? await runPackagedAgentSmoke({ app, page, runRoot, key })
            : null;
        const probe = values.executable
          ? null
          : await app.evaluate(() => ({
              calls: globalThis.__updateProbe.calls,
              forceRequests: globalThis.__updateProbe.forceRequests,
              autoInstall: globalThis.__updateProbe.updater.autoInstallOnAppQuit,
            }));
        if (probe) {
          assert.deepEqual(probe.calls, []);
          assert.equal(probe.forceRequests, 0);
          assert.equal(probe.autoInstall, false);
        }
        // 启动日志可能早于 Playwright 返回 app；使用实际持久日志补齐，不能依赖 stdout 订阅时机。
        const logDir = join(runRoot, ".zcode/v2/logs");
        const mainLogs = (
          await Promise.all(
            (
              await readdir(logDir)
            )
              .filter((name) => name.endsWith(".log"))
              .map((name) => readFile(join(logDir, name), "utf8")),
          )
        ).join("\n");
        log.push(redact(mainLogs, key));
        assert(mainLogs.includes("[auto-update] disabled by product capability"));
        assert(mainLogs.includes("[force-update] disabled by product capability"));
        await closeBaseline(app);
        let networkEvents;
        if (values.executable) {
          const netlog = JSON.parse(await readFile(join(runRoot, "netlog.json"), "utf8"));
          networkEvents = netlog.events.length;
          assert(networkEvents > 0, "real Chromium network evidence must be present");
          assert.equal(
            netlog.events.filter(
              (event) =>
                typeof event.params?.url === "string" &&
                (event.params.url.includes("/api/v1/releases/electron/manifest") ||
                  event.params.url.startsWith(feed)),
            ).length,
            0,
          );
        }
        let restarted = false;
        if (legacy) {
          const restart = await launchBaseline({
            ...launchOptions,
            extraArgs: values.executable
              ? [
                  `--log-net-log=${join(runRoot, "restart-netlog.json")}`,
                  "--net-log-capture-mode=Default",
                ]
              : [],
          });
          const restartChild = restart.app.process();
          try {
            await enterBaselineUI(restart.page);
            assert.deepEqual(await restart.page.evaluate(() => window.zcode.getUpdateState()), {
              kind: "idle",
              enabled: false,
            });
            assert.deepEqual(
              await restart.page.evaluate(() => window.zcode.getAutoUpdatePreferences()),
              { autoDownloadAndInstallUpdates: false },
            );
            if (!values.executable)
              assert.deepEqual(
                await restart.app.evaluate(() => globalThis.__updateProbe.calls),
                [],
              );
            await closeBaseline(restart.app);
            if (values.executable) {
              const events = JSON.parse(
                await readFile(join(runRoot, "restart-netlog.json"), "utf8"),
              ).events;
              assert(events.length > 0);
              assert.equal(
                events.filter(
                  (event) =>
                    typeof event.params?.url === "string" &&
                    (event.params.url.includes("/api/v1/releases/electron/manifest") ||
                      event.params.url.startsWith(feed)),
                ).length,
                0,
              );
            }
            restarted = true;
          } finally {
            if (restartChild.exitCode === null && restartChild.signalCode === null)
              await closeBaseline(restart.app);
          }
        }
        if (legacy) {
          const settings = JSON.parse(await readFile(settingsPath));
          assert.equal(settings.autoDownloadAndInstallUpdates, true);
          assert.equal(settings.receivePreviewUpdates, true);
          assert.deepEqual(settings.pendingPostUpdateReleaseNotes, pending);
          for (const cacheName of [
            oldCacheName,
            `ZCode Baseline ${runRoot.split(/[\\/]/).at(-1)}`,
          ]) {
            const pendingDir = join(runRoot, ".cache", cacheName, "pending");
            await readFile(join(pendingDir, "update-info.json"));
            assert.equal(
              await readFile(join(pendingDir, "old-installer.AppImage"), "utf8"),
              "OLD_DOWNLOADED_PACKAGE_MARKER",
            );
          }
        }
        assert.equal(trapRequests, 0);
        report.cases.push({
          environment,
          legacy,
          rejected: rejected.length,
          probe,
          trapRequests,
          normalExit: true,
          networkEvents,
          restarted,
          packagedAgent: smoke ? inspectPackagedAgentSmoke(runRoot, smoke) : null,
        });
      } finally {
        if (child.exitCode === null && child.signalCode === null) await closeBaseline(app);
        await writeFile(
          join(artifactDir, `${environment}-${legacy ? "legacy" : "clean"}.log`),
          log.join(""),
        );
      }
    }
  }
  report.passed = true;
} catch (error) {
  report.error = redact(error.stack ?? error.message, key);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  trap.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Update evidence: ${artifactDir}/report.json`);
}
assert(report.passed);
