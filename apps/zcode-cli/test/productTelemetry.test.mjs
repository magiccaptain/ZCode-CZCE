import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(require.resolve("esbuild")).href);
const work = await mkdtemp(join(tmpdir(), "zcode-agent-telemetry-test-"));
const outfile = join(work, "boundaries.mjs");
const bundle = await build({
  stdin: {
    contents: [
      'export * from "../packages/telemetry/src/bootstrap.ts";',
      'export * from "../packages/telemetry/src/otlp-exporter.ts";',
      'export * from "../packages/bootstrap/src/telemetry-bootstrap.ts";',
      'export * from "../packages/bootstrap/src/process-resource-sampler.ts";',
      'export * from "../packages/bootstrap/src/zcode-protocol/resource-sampler.ts";',
      'export * from "../packages/bootstrap/src/zcode-protocol-v4/local-ttft.ts";',
      'export * from "../packages/adapters/src/mcp/telemetry.ts";',
      'export * from "../packages/adapters/src/exec/bash-resource-telemetry.ts";',
      'export * from "../packages/adapters/src/exec/execution-command.ts";',
      'export * from "../packages/adapters/src/mcp/network.ts";',
      'export * from "../../../packages/shared/src/runtimeEnv.ts";',
    ].join("\n"),
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  outfile,
  platform: "node",
  format: "esm",
  bundle: true,
  metafile: true,
  banner: {
    js: 'import {createRequire as __createRequire} from "node:module"; const require=__createRequire(import.meta.url);',
  },
  // These are real source boundaries; resolve cross-package public entries to their source
  // so red/green results cannot accidentally execute yesterday's dist.
  plugins: [
    {
      name: "workspace-source",
      setup(builder) {
        builder.onResolve({ filter: /^@zcode\/telemetry$/ }, () => ({
          path: join(import.meta.dirname, "../packages/telemetry/src/index.ts"),
        }));
        builder.onResolve({ filter: /^@zcode\/shared$/ }, () => ({
          path: join(import.meta.dirname, "../../../packages/shared/src/index.ts"),
        }));
      },
    },
  ],
});
const guards = await import(pathToFileURL(outfile).href);
const unexpected = () => assert.fail("product telemetry side effect");

test.after(async () => {
  await rm(work, { recursive: true, force: true });
});

test("explicit OTEL/enabled and legacy identity state cannot prepare a telemetry owner", async () => {
  const home = join(work, "legacy");
  await mkdir(join(home, "v2"), { recursive: true });
  const state = join(home, "v2/telemetry-state.json");
  const bytes = '{"pending":["fixture"]}';
  await writeFile(state, bytes);
  const env = {
    ZCODE_HOME: home,
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
    ZCODE_MODEL_TELEMETRY_ENABLED: "true",
  };
  const prepared = await guards.prepareZCodeTelemetryEnv(env);
  assert.equal(prepared.ZCODE_TELEMETRY_DEVICE_MID, undefined);
  assert.equal(guards.createModelTelemetry().enabled, false);
  await guards.shutdownZCodeTelemetry();
  await guards.shutdownPreparedModelTelemetry();
  assert.equal(await readFile(state, "utf8"), bytes);
});

test("product bootstrap/exporter bundle has no OTel SDK or OTLP exporter dependency", () => {
  assert.deepEqual(
    Object.keys(bundle.metafile.inputs).filter((path) =>
      /@opentelemetry\/(?:sdk-|exporter-|context-async-hooks|otlp-)/.test(path),
    ),
    [],
  );
});

test("model bootstrap ignores old injected owners and does not flush or abandon sessions", async () => {
  const bootstrap = guards.createModelTelemetry({
    sessionId: "fixture",
    owner: {
      enabled: true,
      agentExecution: {},
      modelExecution: {},
      statusSink: {},
      flush: unexpected,
      shutdown: unexpected,
      abandonSession: unexpected,
      updateIdentity: unexpected,
    },
  });
  assert.equal(bootstrap.enabled, false);
  assert.equal(bootstrap.statusSink, undefined);
  await bootstrap.shutdown();
});

test("exporter factory remains disabled even when called directly", async () => {
  const owner = guards.createOwnedAgentTelemetryRuntime({
    endpoint: "http://127.0.0.1:1",
    metricExportIntervalMs: 1,
    resource: {
      runtimeSurface: "standalone_cli",
      runtimeDistribution: "source",
      serviceName: "fixture",
      serviceInstanceId: "fixture",
    },
    onWarning: unexpected,
  });
  assert.equal(owner.enabled, false);
  await owner.flush();
  await owner.shutdown();
  owner.updateIdentity({ identityState: "authenticated", userSubjectId: "fixture" });
});

test("Tool and MCP inherit no telemetry, passthrough cannot reintroduce it, credentials/proxy survive", () => {
  const productEnv = {
    OTEL_TRACES_EXPORTER: "otlp",
    otel_metrics_exporter: "otlp",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
    ZCODE_TELEMETRY_UNLISTED: "1",
    ZCODE_LOCAL_TTFT_ENABLED: "1",
    ZCODE_RESOURCE_TELEMETRY_ENABLED: "1",
    ZCODE_ARMS_RUM_ENDPOINT: "http://127.0.0.1:1",
    ZCODE_RENDERER_ACTION_TRACE_ENABLED: "1",
    zcode_arms_rum_endpoint: "http://127.0.0.1:1",
    zcode_renderer_action_trace_enabled: "1",
  };
  const source = {
    ...productEnv,
    PATH: process.env.PATH,
    OPENAI_API_KEY: "fixture",
    MCP_API_KEY: "fixture",
    ZCODE_TOOL_ENV_PASSTHROUGH_JSON: JSON.stringify({
      ...productEnv,
      HTTPS_PROXY: "http://127.0.0.1:1",
    }),
  };
  for (const key of Object.keys(productEnv)) {
    assert.equal(guards.isZCodeAgentTelemetryEnvKey(key), true, key);
  }
  const sanitized = guards.sanitizeZCodeRuntimeEnv(source);
  for (const key of Object.keys(productEnv)) assert.equal(sanitized[key], undefined, key);
  assert.equal(sanitized.OPENAI_API_KEY, "fixture");
  for (const env of [
    guards.buildExecutionEnv(undefined, { processEnv: source }),
    guards.buildMcpStdioEnv({ env: source }),
  ]) {
    for (const key of Object.keys(productEnv)) assert.equal(env[key], undefined, key);
    assert.equal(env.OPENAI_API_KEY, "fixture");
    assert.equal(env.MCP_API_KEY, "fixture");
    assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:1");
  }
  // Explicit user MCP server env is still merged by transport after inherited env cleaning.
  assert.equal(
    { ...guards.buildMcpStdioEnv({ env: source }), OTEL_TRACES_EXPORTER: "user-choice" }
      .OTEL_TRACES_EXPORTER,
    "user-choice",
  );
  assert.equal(
    guards.buildExecutionEnv(
      { set: { ZCODE_ARMS_RUM_ENDPOINT: "user-choice" } },
      { processEnv: source },
    ).ZCODE_ARMS_RUM_ENDPOINT,
    "user-choice",
  );
  const inPlace = { ...source };
  guards.sanitizeZCodeRuntimeEnvInPlace(inPlace);
  for (const key of Object.keys(productEnv)) assert.equal(inPlace[key], undefined, key);
});

test("MCP keeps local process inventory without resource probe, timer or product events", async () => {
  const calls = [];
  const observe = (kind) => () => {
    calls.push(kind);
  };
  const tracker = guards.createMcpTelemetryTracker({
    idSalt: "fixture",
    onEvent: observe("event"),
    onResourceSamples: observe("resource"),
    processProbe: { reset: observe("reset"), sampleProcessTrees: observe("probe") },
    timer: { setInterval: observe("timer"), clearInterval: observe("clear") },
  });
  tracker.registerConnection({ connectionId: "c", serverName: "fixture", isolation: "workspace" });
  tracker.acquireOwner({ connectionId: "c", ownerId: "lease", sessionId: "s" });
  tracker.recordProcessStarted({ connectionId: "c", pid: 123 });
  assert.equal(tracker.listProcesses()[0].pid, 123);
  tracker.recordSessionStartup({
    configuredCount: 1,
    connectedCount: 1,
    failedCount: 0,
    processCount: 1,
    sessionId: "s",
  });
  tracker.start();
  await tracker.sampleNow();
  tracker.recordProcessCrashed({ connectionId: "c", exitCode: 1, signal: null });
  tracker.releaseOwner({ connectionId: "c", ownerId: "lease" });
  tracker.unregisterConnection({ connectionId: "c" });
  assert.deepEqual(tracker.listProcesses(), []);
  tracker.stop();
  assert.deepEqual(calls, []);
});

test("Bash resource telemetry never probes, subscribes or reads telemetry context", () => {
  let subscriptions = 0;
  const setInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    subscriptions++;
    return setInterval(...args);
  };
  try {
    const sampler = guards.createBashResourceTelemetry({
      processGroupId: 123,
      probe: { sampleProcessGroup: unexpected },
      readContext: unexpected,
      onComplete: unexpected,
    });
    sampler.finish("completed");
    sampler.finish("error");
    assert.equal(subscriptions, 0);
  } finally {
    globalThis.setInterval = setInterval;
  }
});

test("CLI sampler only reads local memory for diagnostics, never product CPU/system samples", () => {
  let tick;
  let diagnostics = 0;
  const sampler = guards.createZCodeProcessResourceSampler({
    onSample: unexpected,
    onMemorySample: () => {
      diagnostics++;
    },
    readCpuUsage: unexpected,
    readMonotonicTimeNs: unexpected,
    readTotalMemoryBytes: unexpected,
    readUptimeSeconds: unexpected,
    readMemoryUsage: () => ({ rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 }),
    timer: {
      setInterval: (callback) => {
        tick = callback;
        return {};
      },
      clearInterval() {},
    },
  });
  sampler.start();
  tick();
  sampler.stop();
  assert.equal(diagnostics, 1);
});

test("real protocol diagnostic tick preserves session maintenance and local log without resource notification", () => {
  let tick;
  const calls = [];
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  globalThis.setInterval = (callback) => {
    tick = callback;
    return { unref() {} };
  };
  globalThis.clearInterval = () => {};
  try {
    const sampler = guards.startProtocolResourceSampler(
      {
        rebalanceResidentSessions: () => calls.push("rebalance"),
        pruneSessionEventStores: () => calls.push("events"),
        pruneDetachedChildPublishers: () => calls.push("publishers"),
        collectMemoryDiagnostics: () => {
          calls.push("diagnostics");
          return {};
        },
      },
      () => calls.push("product notification"),
      { info: () => calls.push("local log") },
    );
    assert.ok(sampler);
    tick();
    sampler.stop();
    assert.deepEqual(calls, ["rebalance", "events", "publishers", "diagnostics", "local log"]);
  } finally {
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
  }
});

test("legacy TTFT envelope cannot collect facts or register a clock watcher", () => {
  const recorder = new guards.LocalTtftRecorder(() => 1, unexpected, unexpected);
  assert.equal(
    recorder.receive({ commandId: "fixture", sessionId: "s", ttft: { submittedAt: 1 } }, false),
    true,
  );
  recorder.admitted("fixture");
  assert.equal(recorder.forSession("s", "fixture"), undefined);
  recorder.clear();
});

test("real subprocess normal and exception exit have no OTLP requests or queue restoration", async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const crash of [false, true]) {
      const script = `import {prepareZCodeTelemetryEnv,createModelTelemetry,shutdownZCodeTelemetry} from ${JSON.stringify(pathToFileURL(outfile).href)};
        await prepareZCodeTelemetryEnv(process.env);
        const telemetry=createModelTelemetry();
        if(telemetry.enabled) throw Error('unexpected owner');
        try { if(${crash}) throw Error('simulated exception'); }
        catch { process.exitCode=7; }
        finally { await telemetry.shutdown(); await shutdownZCodeTelemetry(); }
        console.log('local diagnostic retained');`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        env: {
          ...process.env,
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
          ZCODE_MODEL_TELEMETRY_ENABLED: "true",
          ZCODE_HOME: join(work, "exit"),
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      const code = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      assert.equal(code, crash ? 7 : 0, stderr);
      assert.match(stdout, /local diagnostic retained/);
    }
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
