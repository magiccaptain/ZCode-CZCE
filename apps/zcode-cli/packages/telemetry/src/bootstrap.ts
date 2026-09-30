import type {
  AgentTelemetryRuntimeOwner,
  AgentExecutionTelemetryPort,
  ModelApiRuntimeSurface,
  ModelExecutionTelemetryPort,
  TelemetryIdentitySnapshot,
  TelemetryResourceContext,
} from "@zcode/contracts/telemetry";
import type { ModelStatusSink } from "@zcode/contracts/model";
import { NoopAgentExecutionTelemetry } from "./agent-trace-runtime.js";

type EnvRecord = Record<string, string | undefined>;
const noopExecution = new NoopAgentExecutionTelemetry();

export interface CreateModelTelemetryOptions {
  owner?: AgentTelemetryRuntimeOwner;
  sessionId?: string;
}

export interface ModelTelemetryBootstrap {
  agentExecution: AgentExecutionTelemetryPort;
  enabled: boolean;
  modelExecution: ModelExecutionTelemetryPort;
  statusSink?: ModelStatusSink;
  shutdown(): Promise<void>;
}

/** 本 Fork 的 CLI（包括 standalone 源码入口）不再提供产品遥测执行路径。 */
export function createModelTelemetry(
  _options: CreateModelTelemetryOptions = {},
): ModelTelemetryBootstrap {
  // 根因：旧注入 owner 可绕过 endpoint 禁用并在 Session 退出 flush；必须在工厂拒绝借用。
  return {
    agentExecution: noopExecution,
    enabled: false,
    modelExecution: noopExecution,
    async shutdown() {},
  };
}

export interface PrepareModelTelemetryOptions {
  buildCommitId?: string;
  cliVersion?: string;
  onWarning?: (message: string, context: Record<string, unknown>) => void;
  productVersion?: string;
  runtimeDistribution?: TelemetryResourceContext["runtimeDistribution"];
  runtimeSurface?: ModelApiRuntimeSurface;
}

/** 禁用是发行执行边界，不是可由环境或旧配置覆盖的第二份产品 capability。 */
export async function prepareModelTelemetryEnv(
  env: EnvRecord,
  _options: PrepareModelTelemetryOptions = {},
): Promise<EnvRecord> {
  // 根因：显式 OTEL 曾绕过 Desktop 能力创建身份文件、SDK 与 exporter。
  // 保留公开异步契约，不读旧队列/身份，不 import SDK，也不产生进程 owner。
  return env;
}

export async function shutdownPreparedModelTelemetry(): Promise<void> {}

export function updatePreparedTelemetryIdentity(_snapshot: TelemetryIdentitySnapshot): void {}

// 纯解析工具保留上游公开契约；解析结果不再授予初始化权限。
export function resolveOtlpTraceEndpoint(env: EnvRecord): string | undefined {
  const traceEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (traceEndpoint) return validHttpUrl(traceEndpoint);
  const commonEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!commonEndpoint) return undefined;
  const valid = validHttpUrl(commonEndpoint);
  if (!valid) return undefined;
  const parsed = new URL(valid);
  parsed.pathname = `${parsed.pathname.replace(/\/$/u, "")}/v1/traces`;
  return parsed.toString();
}

export function resolveOtlpMetricEndpoint(env: EnvRecord): string | undefined {
  const metricEndpoint = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim();
  if (metricEndpoint) return validHttpUrl(metricEndpoint);
  const commonEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (commonEndpoint) {
    const valid = validHttpUrl(commonEndpoint);
    if (!valid) return undefined;
    const parsed = new URL(valid);
    parsed.pathname = `${parsed.pathname.replace(/\/$/u, "")}/v1/metrics`;
    return parsed.toString();
  }
  return resolveOtlpTraceEndpoint(env);
}

export function parseOtlpHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value?.trim()) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const key = safeDecode(pair.slice(0, separator).trim());
    const headerValue = safeDecode(pair.slice(separator + 1).trim());
    if (key && headerValue) headers[key] = headerValue;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function normalizeTelemetryDeviceMid(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && /^[A-Za-z0-9._:-]{1,128}$/u.test(normalized) ? normalized : undefined;
}

function validHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
