import {
  PLUGIN_MARKETPLACE_CAPABILITY_ENV,
  PLUGIN_MARKETPLACE_UNAVAILABLE,
  type ProductCapabilities,
} from "@zcode/shared";

/** 固定值归 Desktop；缺省维持非 Desktop 调用方的原有能力。 */
export type PluginMarketplaceCapabilities = Readonly<
  Partial<Pick<ProductCapabilities, "pluginMarketplace">>
>;

export function assertPluginMarketplaceEnabled(capabilities?: PluginMarketplaceCapabilities): void {
  // 旧市场配置/排队请求不能在管理进程启动前绕过产品关闭。
  if (capabilities?.pluginMarketplace === false) throw new Error(PLUGIN_MARKETPLACE_UNAVAILABLE);
}

/** 最终 spawn 合并后应用，command.env 与 shell inherited 值不能覆盖 Desktop 固定事实。 */
export function buildPluginMarketplaceSpawnEnv(
  capabilities?: PluginMarketplaceCapabilities,
): Record<string, string> {
  return capabilities?.pluginMarketplace === undefined
    ? {}
    : { [PLUGIN_MARKETPLACE_CAPABILITY_ENV]: String(capabilities.pluginMarketplace) };
}
