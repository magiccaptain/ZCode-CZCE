import type { ZCodeToolExecResource } from "@zcode/shared";
import type { ProcessProbe } from "../device/process-probe.js";

interface BashResourceTelemetryOptions {
  processGroupId?: number;
  platform?: NodeJS.Platform;
  probe?: Pick<ProcessProbe, "sampleProcessGroup">;
  onComplete: (sample: ZCodeToolExecResource) => void;
  readContext?: () => Pick<ZCodeToolExecResource, "cliRssKb" | "systemFreeMemoryKb">;
}

/** 不安装资源探针或进度订阅；Bash 自身的输出/取消/进程回收不变。 */
export function createBashResourceTelemetry(_options: BashResourceTelemetryOptions): {
  finish(exitKind: ZCodeToolExecResource["exitKind"]): void;
} {
  // 根因：Host 不接收通知仍不能阻止 Tool 在本地采集/订阅，关闭必须在采集工厂执行。
  return { finish() {} };
}
