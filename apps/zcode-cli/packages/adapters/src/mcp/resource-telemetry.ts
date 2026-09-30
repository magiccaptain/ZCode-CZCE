import type { ZCodeMcpResourceSample } from "@zcode/shared";
import type {
  ProcessProbe,
  ProcessProbeSample,
  ProcessTreeScope,
} from "../device/process-probe.js";

interface TimerHandle {
  unref?(): void;
}
export interface McpResourceTimer {
  clearInterval(handle: TimerHandle): void;
  setInterval(callback: () => void, intervalMs: number): TimerHandle;
}

export interface McpResourceProcess {
  instanceId: string;
  mcpId: string;
  pid: number;
  startedAt: number;
  isCurrent(): boolean;
  observed(
    samples: readonly ProcessProbeSample[] | undefined,
    sampledAt: number,
    scope: ProcessTreeScope,
  ): void;
}

export interface McpResourceTelemetryOptions {
  arch: ZCodeMcpResourceSample["arch"];
  platform: ZCodeMcpResourceSample["platform"];
  now(): number;
  getProcesses(): McpResourceProcess[];
  onResourceSamples?(samples: ZCodeMcpResourceSample[]): void;
  processProbe?: ProcessProbe;
  logicalCpuCount?: number;
  totalMemoryGb?: number;
  timer?: McpResourceTimer;
}

/** 本 Fork 保留 MCP 生命周期列表，产品资源采集不构造探针、timer 或采样队列。 */
export function createMcpResourceTelemetry(_options: McpResourceTelemetryOptions) {
  // 根因：通知出口关闭仍会运行 MCP 树探针和定时器，执行边界必须早于构造。
  return {
    async sampleNow(): Promise<void> {},
    start() {},
    stop() {},
  };
}
