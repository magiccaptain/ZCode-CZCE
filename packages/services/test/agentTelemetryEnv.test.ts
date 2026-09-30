import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentTelemetrySpawnEnv,
  stripAgentProductTelemetryEnv,
} from "../src/zcode-agent/agentTelemetryEnv.js";

test("Fork Agent telemetry adaptation cannot inject explicit product telemetry", () => {
  assert.deepEqual(
    buildAgentTelemetrySpawnEnv({
      productCapabilities: { telemetry: false },
      telemetryEnv: {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
        ZCODE_MODEL_TELEMETRY_ENABLED: "true",
      },
      deviceMid: "fixture",
      userId: "fixture",
      runtimeSurface: "desktop_local_host",
    }),
    {},
  );
});

test("final Agent env merge removes telemetry overrides but retains identity, broker and normal network", () => {
  const env = stripAgentProductTelemetryEnv({
    PATH: "/fixture",
    OPENAI_API_KEY: "fixture",
    ZCODE_WORKSPACE_IDENTITY: "fixture",
    ZCODE_CUA_PERMISSION_BROKER_SOCKET: "/fixture/socket",
    ZCODE_HTTP_PROXY: "http://127.0.0.1:1",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
    otel_traces_exporter: "otlp",
    ZCODE_TELEMETRY_DEVICE_MID: "fixture",
    ZCODE_LOCAL_TTFT_ENABLED: "1",
    ZCODE_RESOURCE_TELEMETRY_ENABLED: "1",
    // 最终合并的 command/spawn override 也不能把旧产品配置带回 Agent。
    ZCODE_ARMS_RUM_ENDPOINT: "http://127.0.0.1:1",
    ZCODE_RENDERER_ACTION_TRACE_ENABLED: "1",
    zcode_arms_rum_endpoint: "http://127.0.0.1:1",
    zcode_renderer_action_trace_enabled: "1",
  });
  assert.deepEqual(env, {
    PATH: "/fixture",
    OPENAI_API_KEY: "fixture",
    ZCODE_WORKSPACE_IDENTITY: "fixture",
    ZCODE_CUA_PERMISSION_BROKER_SOCKET: "/fixture/socket",
    ZCODE_HTTP_PROXY: "http://127.0.0.1:1",
  });
});
