import type { PrepareModelTelemetryOptions } from "@zcode/telemetry";

/** Fork CLI 不准备产品遥测身份或读取 captured OTEL；保留原异步启动接口。 */
export async function prepareZCodeTelemetryEnv(
  env: NodeJS.ProcessEnv = process.env,
  _options: PrepareModelTelemetryOptions = {},
): Promise<NodeJS.ProcessEnv> {
  // 根因：旧启动入口在清洗后从 captured env 恢复产品配置，显式 enabled 可重新初始化。
  return env;
}

/** 最外层正常/异常退出均不能恢复旧 owner 或 flush 队列。 */
export async function shutdownZCodeTelemetry(): Promise<void> {}
