import type { ProductCapabilities } from "@zcode/shared";

/** 只读装配输入；固定产品值只由 Desktop 拥有，缺省保留其他调用方兼容。 */
export type AccountProductCapabilities = Readonly<
  Partial<Pick<ProductCapabilities, "productAccount" | "productSubscription" | "appUpdates">>
>;

export const PRODUCT_ACCOUNT_UNAVAILABLE = "PRODUCT_ACCOUNT_UNAVAILABLE";
export const PRODUCT_SUBSCRIPTION_UNAVAILABLE = "PRODUCT_SUBSCRIPTION_UNAVAILABLE";

export function isProductSubscriptionEnabled(capabilities?: AccountProductCapabilities): boolean {
  return capabilities?.productAccount !== false && capabilities?.productSubscription !== false;
}

export function assertProductAccountEnabled(capabilities?: AccountProductCapabilities): void {
  // 旧 token/缓存不能恢复被产品装配关闭的能力；必须在凭据读取与网络副作用前拒绝。
  if (capabilities?.productAccount === false) throw new Error(PRODUCT_ACCOUNT_UNAVAILABLE);
}

export function assertProductSubscriptionEnabled(capabilities?: AccountProductCapabilities): void {
  if (!isProductSubscriptionEnabled(capabilities))
    throw new Error(PRODUCT_SUBSCRIPTION_UNAVAILABLE);
}
