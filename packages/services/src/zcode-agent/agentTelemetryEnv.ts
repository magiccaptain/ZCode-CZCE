import { isZCodeAgentTelemetryEnvKey, type ProductCapabilities } from "@zcode/shared";

interface BuildAgentTelemetrySpawnEnvInput {
  productCapabilities?: Readonly<Pick<ProductCapabilities, "telemetry">>;
  telemetryEnv: Record<string, string>;
  deviceMid?: string;
  userId?: string;
  runtimeSurface: "desktop_local_host" | "remote_workspace_host";
}

/** Desktop capability 沿既有启动适配传入；Fork 不再提供产品遥测注入路径。 */
export function buildAgentTelemetrySpawnEnv(
  _input: BuildAgentTelemetrySpawnEnvInput,
): Record<string, string> {
  // 根因：旧 endpoint/身份配置曾在通用 env 清洗之后重新注入，能绕过产品关闭。
  // 产品遥测在本 Fork 不可启用，保留适配契约但不读取或传递任何配置。
  return {};
}

/** 最终合并后仅剔除产品 inherited 配置，不能再次清洗 broker/网络/identity。 */
export function stripAgentProductTelemetryEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !isZCodeAgentTelemetryEnvKey(entry[0]),
    ),
  );
}
