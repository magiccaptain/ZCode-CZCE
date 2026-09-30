import type {
  AgentTelemetryRuntimeOwner,
  TelemetryIdentitySnapshot,
  TelemetryResourceContext,
} from "@zcode/contracts/telemetry";
import { NoopAgentExecutionTelemetry } from "./agent-trace-runtime.js";

interface CreateOwnedAgentTelemetryRuntimeOptions {
  endpoint: string;
  headers?: Record<string, string>;
  identity?: TelemetryIdentitySnapshot;
  maxBatchSize?: number;
  maxQueueSize?: number;
  metricEndpoint?: string;
  metricExportIntervalMs?: number;
  metricHeaders?: Record<string, string>;
  onWarning?: (message: string, context: Record<string, unknown>) => void;
  resource: TelemetryResourceContext;
  timeoutMs?: number;
  traceSampleRatio?: number;
}

/** 保留旧工厂接口，但本 Fork 不构造 SDK/exporter/context manager/queue。 */
export function createOwnedAgentTelemetryRuntime(
  _options: CreateOwnedAgentTelemetryRuntimeOptions,
): AgentTelemetryRuntimeOwner {
  // 根因：只关闭 bootstrap 仍留下可直接创建并退出上传的旧 exporter 执行口。
  const execution = new NoopAgentExecutionTelemetry();
  return {
    abandonSession() {},
    agentExecution: execution,
    enabled: false,
    modelExecution: execution,
    async flush() {},
    async shutdown() {},
    updateIdentity() {},
  };
}
