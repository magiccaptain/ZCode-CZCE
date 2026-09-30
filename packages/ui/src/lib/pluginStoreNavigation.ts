import type { ProductCapabilities } from "@zcode/shared";

type MarketplaceCapabilities = Readonly<Partial<Pick<ProductCapabilities, "pluginMarketplace">>>;

const OPEN_PLUGIN_STORE_EVENT = "zcode:open-plugin-store";

export interface PluginStoreOpenTarget {
  pluginId?: string;
  intent?: "add-marketplace";
  returnScopeKey?: string;
}

let pendingTarget: PluginStoreOpenTarget | null = null;

/** 统一承载 Store 入口的目标插件与 Settings 返回位置。Marketplace 只允许返回 User 视图。 */
export function requestPluginStoreOpen(
  value?: string | PluginStoreOpenTarget,
  capabilities?: MarketplaceCapabilities,
): void {
  // 旧程序化入口不能留下待恢复的市场 intent。
  if (capabilities?.pluginMarketplace === false) {
    pendingTarget = null;
    return;
  }
  const normalized = typeof value === "string" ? value.trim() : undefined;
  pendingTarget =
    typeof value === "object"
      ? { ...value, ...(value.returnScopeKey ? { returnScopeKey: "user" } : {}) }
      : normalized
        ? normalized.includes("@")
          ? { pluginId: normalized }
          : { returnScopeKey: "user" }
        : {};
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PluginStoreOpenTarget>(OPEN_PLUGIN_STORE_EVENT, {
      detail: pendingTarget,
    }),
  );
}

export function consumePluginStoreOpenTarget(
  capabilities?: MarketplaceCapabilities,
): PluginStoreOpenTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return capabilities?.pluginMarketplace === false ? null : target;
}

export function addPluginStoreOpenListener(
  listener: (target: PluginStoreOpenTarget) => void,
  capabilities?: MarketplaceCapabilities,
): () => void {
  if (capabilities?.pluginMarketplace === false) {
    pendingTarget = null;
    return () => {};
  }
  if (typeof window === "undefined") return () => {};
  const handleOpen = (event: Event) => {
    listener((event as CustomEvent<PluginStoreOpenTarget>).detail ?? {});
  };
  window.addEventListener(OPEN_PLUGIN_STORE_EVENT, handleOpen);
  return () => window.removeEventListener(OPEN_PLUGIN_STORE_EVENT, handleOpen);
}
