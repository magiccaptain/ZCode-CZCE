import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const buildRequire = createRequire(require.resolve("tsup"));
const { build } = await import(pathToFileURL(buildRequire.resolve("esbuild")).href);
const outfile = join(import.meta.dirname, "../.e2e-cache/telemetry-guards-test.mjs");
await mkdir(join(import.meta.dirname, "../.e2e-cache"), { recursive: true });
await build({
  stdin: {
    contents: [
      "main/desktopResourceTelemetry",
      "main/desktopNetworkTelemetry",
      "main/desktopZCodeDataSizeTelemetry",
      "main/appTelemetryRuntime",
      "main/desktopArmsRum",
      "main/rendererActionTraceExporter",
      "main/localTtftExporter",
      "main/rendererActionTraceRollout",
      "main/rendererActionTraceIpc",
      "main/desktopRemoteUsageArmsTelemetry",
      "host/hostNetworkTelemetry",
      "host/hostServiceResourceTelemetry",
      "host/hostSelfResourceTelemetry",
      "host/hostSessionCreateTelemetry",
      "scheduler/schedulerResourceTelemetry",

      "shared/armsRumBridgeForward",
      "renderer/appTelemetryBridge",
      "renderer/src/userActionTraceBootstrap",
      "renderer/src/localTtftBootstrap",
    ]
      .map((file) => `export * from '../src/${file}.ts';`)
      .join("\n"),
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "electron-port",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(electron|@zcode\/ui)$|\.\/(desktopRuntimeEnv|resourceManagerWindow|processResourceSampleSourceRegistry)\.js$/,
          },
          (args) => ({
            path: args.path,
            namespace: "port",
          }),
        );
        builder.onLoad({ filter: /.*/, namespace: "port" }, ({ path }) => ({
          contents: path.includes("desktopRuntimeEnv")
            ? 'export const desktopRuntimeEnv="development";'
            : path.includes("resourceManagerWindow")
              ? 'export const listRegisteredHostAgentProcessIds=()=>{throw Error("resource probe")};'
              : path.includes("processResourceSampleSourceRegistry")
                ? 'export const PROCESS_RESOURCE_SAMPLE_SOURCES=[{id:"fixture",sample(){throw Error("resource sample")}}];'
                : path === "@zcode/ui"
                  ? "export class RendererUserActionTelemetry {constructor(){throw Error('SDK created')}}; export class LocalTtftObserver {constructor(){throw Error('observer created')}}; export const setUserActionTelemetry=()=>{}; export const setLocalTtftObserver=()=>{};"
                  : "export const ipcMain=globalThis.__telemetryIpc; export const BrowserWindow={getAllWindows:()=>[]};",
          loader: "js",
        }));
      },
    },
  ],
});
const handlers = new Map();
const listeners = new Map();
globalThis.__telemetryIpc = {
  handle: (channel, handler) => handlers.set(channel, handler),
  on: (channel, handler) => listeners.set(channel, handler),
  removeHandler: (channel) => handlers.delete(channel),
  removeAllListeners: (channel) => listeners.delete(channel),
};
const guards = await import(pathToFileURL(outfile).href);
const { PlatformChannels, DISABLED_RENDERER_ACTION_TRACE_CONFIG } = await import("@zcode/shared");
const unexpected = () => assert.fail("disabled telemetry side effect");
const logger = { warn: unexpected, debug() {}, info() {} };

test("Main launch coordinator is preserved without heartbeat, collection or flush", () => {
  let ready = 0;
  const runtime = guards.createAppTelemetryRuntime({
    telemetryCore: { reportAppLaunch: unexpected, reportAppDailyActive: unexpected },
    appLaunchCoordinator: {
      onRendererReady: () => {
        ready++;
        return true;
      },
      onOAuthCallbackHandled: () => true,
    },
    setInterval: unexpected,
    clearInterval: unexpected,
  });
  runtime.onRendererReady({ rendererId: 1, hasPendingOAuthCallback: false });
  runtime.syncRendererContext({ rendererId: 1, context: {} });
  runtime.setInteractive(true);
  runtime.onOAuthCallbackHandled({ rendererId: 1 });
  assert.equal(runtime.getLatestRendererContext(), null);
  runtime.dispose();
  assert.equal(ready, 1);
});

test("explicit OTEL environment cannot create exporters, recover batches or flush", async () => {
  const env = {
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    ZCODE_LOCAL_TTFT_ENABLED: "1",
    ZCODE_RENDERER_ACTION_TRACE_ENABLED: "1",
  };
  assert.equal(guards.createRendererActionTraceExporter(env), undefined);
  const exporter = guards.createLocalTtftExporter({ env, version: "test", logger });
  assert.equal(exporter.enqueue({}), false);
  await exporter.shutdown();
});

test("trace IPC cannot request rollout, admit legacy batch or start periodic refresh", async () => {
  const rollout = guards.createRendererActionTraceRollout({ fetchConfig: unexpected, logger });
  assert.deepEqual(await rollout.refresh(), DISABLED_RENDERER_ACTION_TRACE_CONFIG);
  const dispose = guards.registerRendererActionTraceIpc({
    rollout,
    broker: { enqueue: unexpected },
    logger,
    env: { ZCODE_RENDERER_ACTION_TRACE_ENABLED: "1" },
  });
  assert.deepEqual(
    await handlers.get(PlatformChannels.GetRendererActionTraceConfig)(),
    DISABLED_RENDERER_ACTION_TRACE_CONFIG,
  );
  listeners.get(PlatformChannels.ReportRendererActionTraceBatch)?.(
    { sender: {} },
    { rendererInstanceId: "old" },
  );
  dispose();
  guards.configureRemoteUsageArmsTelemetry({ setInterval: unexpected });
});

test("Host has no service subscriptions or session telemetry, local memory logging survives", () => {
  guards
    .registerHostServiceResourceTelemetry({
      services: { getOptional: unexpected },
      postMessage: unexpected,
      runtimeSurface: "local",
    })
    .dispose();
  guards.reportHostSessionCreate(
    { postMessage: unexpected },
    { sessionId: "test", messageId: "test", source: "automation" },
  );
  let lines = 0;
  const memory = guards.startHostSelfResourceTelemetry({
    logger: { info: () => lines++ },
    collectCounters: () => ({}),
    postMessage: unexpected,
    timer: { setInterval: () => ({}), clearInterval() {} },
  });
  memory.sampleNow();
  memory.stop();
  assert.equal(lines, 1);
});

test("preload drops legacy ARMS arrays but forwards normal IPC; renderer collects no context", () => {
  const sent = [];
  const ipc = { send: (...args) => sent.push(args) };
  guards.installArmsRumBridgeIpcForward(ipc);
  ipc.send("arms:rum-bridge", '[{"old":true}]');
  ipc.send("normal", "kept");
  assert.deepEqual(sent, [["normal", "kept"]]);
  guards.syncAppTelemetryContext({
    bridge: { syncTelemetryContext: unexpected },
    createRendererContext: unexpected,
    productCapabilities: { telemetry: false },
  });
});

test("Renderer initialization precedes random IDs, SDKs, listeners and timers", () => {
  const platform = {
    productCapabilities: { telemetry: false },
    reportRendererActionTraceBatch: unexpected,
    getRendererActionTraceConfig: unexpected,
    reportLocalTtftBatch: unexpected,
  };
  guards.initializeDesktopUserActionTrace({ platform, isLocalDevelopmentRuntime: false })();
  guards.initializeDesktopLocalTtft(platform)();
});

test("disabled product never imports the side-effectful ARMS SDK", () => {
  assert.throws(() => guards.getDesktopArmsRum(), /telemetry is disabled/);
  assert.equal(
    Object.keys(require.cache).some((path) => path.includes("@arms/rum-electron")),
    false,
  );
});

test("scheduler cannot construct resource samples or a collection timer under disabled product", () => {
  guards
    .startSchedulerResourceTelemetry({
      readCpuUsage: unexpected,
      readMemoryUsage: unexpected,
      postMessage: unexpected,
      timer: { setInterval: unexpected, clearInterval: unexpected },
    })
    .stop();
});

test("Host network has no collection timer or exit flush", () => {
  const interval = globalThis.setInterval;
  try {
    globalThis.setInterval = unexpected;
    guards.registerHostNetworkTelemetry({ postMessage: unexpected });
    guards.stopHostNetworkTelemetry();
  } finally {
    globalThis.setInterval = interval;
  }
});

test("Main resource/network/data tasks stay disabled while local memory logging remains", () => {
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  let localSample;
  let logs = 0;
  try {
    globalThis.setInterval = (callback, ms) => {
      assert.equal(ms, 60000);
      assert.equal(localSample, undefined);
      localSample = callback;
      return { unref() {} };
    };
    globalThis.clearInterval = () => {};
    const localLogger = { info: () => logs++, warn: unexpected };
    guards.registerDesktopNetworkTelemetry(localLogger);
    guards.registerDesktopZCodeDataSizeTelemetry({
      get context() {
        assert.fail("scheduler state read");
      },
    });
    guards.configureDesktopResourceTelemetry({});
    guards.registerDesktopResourceTelemetry(localLogger);
    localSample();
    assert.equal(logs, 1);
    guards.stopDesktopResourceTelemetry({ flushPendingWindows: true });
    guards.stopDesktopNetworkTelemetry();
    guards.stopDesktopZCodeDataSizeTelemetry();
  } finally {
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
  }
});
