import { APP_UPDATES_UNAVAILABLE, type ProductCapabilities } from "@zcode/shared";

/** 唯一的 Desktop 产品范围来源；本 PR 仅落实 appUpdates，其余关闭路径由后续 PR 接入。 */
export const DESKTOP_PRODUCT_CAPABILITIES: ProductCapabilities = Object.freeze({
  localAgent: true,
  localProviderConfig: true,
  skills: true,
  mcp: true,
  webProduct: false,
  appUpdates: false,
  pluginMarketplace: false,
  productAccount: false,
  productSubscription: false,
  sharing: false,
  telemetry: false,
  remoteWorkspaces: false,
  mobileRemoteControl: false,
});

export function assertAppUpdatesAvailable(): void {
  if (!DESKTOP_PRODUCT_CAPABILITIES.appUpdates) {
    throw new Error(
      `${APP_UPDATES_UNAVAILABLE}: application updates are disabled for this product`,
    );
  }
}
