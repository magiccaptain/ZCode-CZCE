import { PLUGIN_MARKETPLACE_CAPABILITY_ENV, PLUGIN_MARKETPLACE_UNAVAILABLE } from "@zcode/shared";

// Desktop 在最终 spawn 边界传入同源能力；启动捕获后不再读取可变 env/旧用户配置。
// 独立 CLI 未传此装配输入时保持上游行为，不在 Runtime 复制 Desktop 固定配置。
const marketplaceEnabledAtStartup = process.env[PLUGIN_MARKETPLACE_CAPABILITY_ENV] !== "false";

export function isPluginMarketplaceEnabled(): boolean {
  return marketplaceEnabledAtStartup;
}

export function assertPluginMarketplaceEnabled(): void {
  if (!marketplaceEnabledAtStartup) throw new Error(PLUGIN_MARKETPLACE_UNAVAILABLE);
}
