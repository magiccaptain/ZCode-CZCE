import assert from "node:assert/strict";
import { assertDisabledTelemetryInput } from "./lexical-input-telemetry.mjs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { parseArgs } from "node:util";
import { runPackagedAgentSmoke, inspectPackagedAgentSmoke } from "./packaged-smoke.mjs";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { PlatformChannels, TID_TASK_SETTINGS_BUTTON } from "@zcode/shared";
import {
  buildBaseline,
  launchBaseline,
  enterBaselineUI,
  prepareBaselineLocale,
  closeBaseline,
  desktopRoot,
  repositoryRoot,
} from "./runtime.mjs";

const { values } = parseArgs({
  options: { executable: { type: "string" }, "key-file": { type: "string" } },
});
assert(!values["key-file"] || values.executable, "model smoke requires a packaged executable");
if (values["key-file"]) {
  const keyRelative = relative(repositoryRoot, resolve(values["key-file"]));
  assert(
    keyRelative.startsWith(`..${sep}`) || isAbsolute(keyRelative),
    "keep credentials outside repository",
  );
}
const key = values["key-file"]
  ? (await readFile(values["key-file"], "utf8")).trim()
  : "no-secret-used";
// Desktop 关闭专项；真实核心与 Agent/Tool/MCP 继承边界另由 baseline --telemetry 和组件测试覆盖。
const root = await mkdtemp(join(tmpdir(), "zcode-telemetry-"));
const artifactDir = join(desktopRoot, ".e2e-artifacts", `telemetry-${Date.now()}`);
await mkdir(artifactDir, { recursive: true, mode: 0o700 });
let trapRequests = 0;
const trap = createServer((_req, res) => {
  trapRequests++;
  res.writeHead(500);
  res.end();
});
await new Promise((resolve) => trap.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${trap.address().port}`;
const report = {
  platform: `${process.platform}-${process.arch}`,
  cases: [],
  passed: false,
  agentBoundaryValidated: false,
  packaged: Boolean(values.executable),
};
const version = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).version;
try {
  for (const environment of values.executable ? ["packaged"] : ["production", "test"]) {
    if (!values.executable) await buildBaseline(environment);
    for (const legacy of [false, true]) {
      const caseName = `${environment}-${legacy ? "legacy" : "clean"}`;
      const runRoot = join(root, caseName);
      await mkdir(join(runRoot, "electron/rum-electron-store"), { recursive: true });
      await prepareBaselineLocale(runRoot);
      const oldQueue = join(runRoot, "electron/rum-electron-store/legacy.json");
      const oldState = join(runRoot, "electron/zcode-data-size-telemetry.json");
      const oldIdentityState = join(runRoot, ".zcode/v2/telemetry-state.json");
      const identityBytes =
        '{"deviceMid":"fixture-existing-identity","pending":["LEGACY_TELEMETRY_MARKER"]}';
      const queueBytes = '{"pending":"LEGACY_TELEMETRY_MARKER"}';
      const stateBytes = '{"nextRunAt":1,"lastSuccessAt":1}';
      if (legacy) {
        await writeFile(oldQueue, queueBytes);
        await writeFile(oldState, stateBytes);
        await writeFile(oldIdentityState, identityBytes);
      }
      const bootstrap = join(desktopRoot, ".e2e-cache", `telemetry-bootstrap-${environment}.mjs`);
      await writeFile(
        bootstrap,
        `
import { ipcMain, session, crashReporter } from 'electron';
import { createRequire } from 'node:module';
const handlers = new Map();
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => { handlers.set(channel, fn); return handle(channel, fn); };
const crashStart = crashReporter.start.bind(crashReporter);
let localCrashStarted = false;
crashReporter.start = options => { localCrashStarted = options.uploadToServer === false; return crashStart(options); };
globalThis.__telemetryProbe = { handlers, requests: 0, localCrashStarted: () => localCrashStarted, sdkLoaded: () => Object.keys(createRequire(import.meta.url).cache).some(path => path.includes('@arms/rum-electron')) };
await import(${JSON.stringify(pathToFileURL(join(desktopRoot, "out/main/index.js")).href)});
session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
 if (/\\/event\\/report(?:\\?|$)|rum.*log|log.*aliyuncs/i.test(details.url)) globalThis.__telemetryProbe.requests++;
 callback({cancel:false});
});
`,
      );
      const log = [];
      const { app, page } = await launchBaseline({
        runRoot,
        key,
        version,
        main: bootstrap,
        executablePath: values.executable,
        extraArgs: values.executable
          ? [`--log-net-log=${join(runRoot, "netlog.json")}`, "--net-log-capture-mode=Default"]
          : [],
        log,
        envPatch: {
          HOME: runRoot,
          OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${endpoint}/v1/metrics`,
          ZCODE_TELEMETRY_ENABLED: "1",
          ZCODE_RENDERER_ACTION_TRACE_ENABLED: "1",
          ZCODE_LOCAL_TTFT_ENABLED: "1",
        },
      });
      try {
        await enterBaselineUI(page);
        await assertDisabledTelemetryInput(page);
        assert.equal(await page.evaluate(() => window.zcode.productCapabilities.telemetry), false);
        // 正常 preload 入口与错误路径不应启动采集或建立观测队列。
        const config = await page.evaluate(async () => {
          await window.zcode.reportTelemetryEvent({
            context: {},
            elementName: "fixture",
            eventRegion: "app",
            eventType: "result",
            eventExtraDetail: {},
          });
          await window.zcode.reportArmsCustomEvent({ name: "fixture_error", group: "fixture" });
          window.zcode.reportLocalTtftBatch({
            version: 1,
            rendererInstanceId: "legacy",
            sequence: 1,
            records: [],
            dropped: 0,
          });
          window.zcode.reportRendererActionTraceBatch({ rendererInstanceId: "legacy" });
          window.zcode.reportRendererHeapSample({ heapUsedKb: 1 });
          return window.zcode.getRendererActionTraceConfig();
        });
        assert.equal(config.enabled, false);
        assert.notEqual(config.localTtftEnabled, true);
        assert.equal(
          await page.evaluate(() => Boolean(window.RumSDK || window.__zcodeArmsCustomEventsE2E)),
          false,
        );
        // 绕过 preload 直接调用真实 Main handlers，验证 malformed/旧 payload 也不能触发上传。
        if (!values.executable)
          await app.evaluate(
            async ({ BrowserWindow }, channels) => {
              const event = { sender: BrowserWindow.getAllWindows()[0].webContents };
              for (const channel of channels)
                await globalThis.__telemetryProbe.handlers.get(channel)(event, { legacy: true });
            },
            [PlatformChannels.ReportTelemetryEvent, PlatformChannels.ReportArmsCustomEvent],
          );
        // 模拟原生错误通知（不是实际崩溃），本地 crash 诊断保留，产品错误上报不能启动 SDK。
        await app.evaluate(({ app }) => {
          app.emit(
            "child-process-gone",
            {},
            { type: "Utility", reason: "crashed", exitCode: 1, name: "telemetry-fixture" },
          );
        });
        assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(values.executable));
        assert.equal(
          await app.evaluate(() =>
            Object.keys(
              process.getBuiltinModule("module").createRequire(process.execPath).cache,
            ).some((path) => path.includes("@arms/rum-electron")),
          ),
          false,
        );
        if (!values.executable) {
          assert.equal(await app.evaluate(() => globalThis.__telemetryProbe.requests), 0);
          assert.equal(
            await app.evaluate(() => globalThis.__telemetryProbe.localCrashStarted()),
            true,
          );
        }
        assert.equal(
          await app.evaluate(({ crashReporter }) => crashReporter.getUploadToServer()),
          false,
        );
        let agentSmoke;
        if (values["key-file"] && !legacy) {
          await page.getByTestId(TID_TASK_SETTINGS_BUTTON).click();
          agentSmoke = await runPackagedAgentSmoke({ app, page, runRoot, key });
        }
        const exited = await closeBaseline(app);
        assert.equal(exited.code, 0);
        assert.equal(trapRequests, 0);
        let networkEvents;
        if (values.executable) {
          const netlog = JSON.parse(await readFile(join(runRoot, "netlog.json"), "utf8"));
          networkEvents = netlog.events.length;
          assert(networkEvents > 0, "actual Chromium network log");
          assert(
            !netlog.events.some((event) =>
              /\/event\/report(?:\?|$)|rum.*log|log.*aliyuncs/i.test(event.params?.url ?? ""),
            ),
          );
        }
        if (agentSmoke) agentSmoke = inspectPackagedAgentSmoke(runRoot, agentSmoke);
        if (legacy) {
          assert.equal(await readFile(oldQueue, "utf8"), queueBytes);
          assert.equal(await readFile(oldState, "utf8"), stateBytes);
          assert.equal(await readFile(oldIdentityState, "utf8"), identityBytes);
        }
        assert(
          !log.some((line) =>
            /\[arms\] electron initialized|\[network\] reporting started|\[resource\] sampling started/.test(
              line,
            ),
          ),
        );
        assert(log.some((line) => line.includes("disposing host resources")));
        report.cases.push({
          environment,
          legacy,
          oldQueuePreserved: legacy,
          existingIdentityStateBytesPreserved: legacy,
          sdkLoaded: false,
          lexicalInputPreserved: true,
          productRequests: 0,
          explicitOtelRequests: trapRequests,
          exitCode: exited.code,
          networkEvents,
          agentSmoke,
        });
      } finally {
        await app.close().catch(() => {});
        await writeFile(join(artifactDir, `${caseName}-runtime.log`), log.join(""));
      }
    }
  }
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => trap.close(resolve));
  await writeFile(join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ artifactDir, ...report }, null, 2));
}
