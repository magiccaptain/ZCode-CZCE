import type { IPluginSyncService, IPluginsService, IZCodeAgentService } from "@zcode/services";
import type { PluginMarketplaceCapabilities } from "@zcode/services/node";
import { PLUGIN_MARKETPLACE_UNAVAILABLE } from "@zcode/shared";

/** 旧远端 server 未必识别产品能力；Desktop 必须在 RPC dispatch 前拒绝，而不能依赖远端默认允许。 */
function guardRemoteMethods<T extends object>(
  service: T,
  methods: readonly (keyof T)[],
  capabilities?: PluginMarketplaceCapabilities,
): T {
  const guarded = new Set<PropertyKey>(methods);
  return new Proxy(service, {
    get(target, property) {
      if (guarded.has(property) && capabilities?.pluginMarketplace === false) {
        return async () => {
          throw new Error(PLUGIN_MARKETPLACE_UNAVAILABLE);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function scopeRemoteMarketplaceAgent(
  agent: IZCodeAgentService,
  capabilities?: PluginMarketplaceCapabilities,
): IZCodeAgentService {
  return guardRemoteMethods(
    agent,
    [
      "getPluginsOverview",
      "resolveSuggestedPluginReference",
      "addPluginMarketplace",
      "removePluginMarketplace",
      "updatePluginMarketplace",
      "installPlugin",
      "updatePlugin",
      "validatePlugin",
      "describePlugin",
    ],
    capabilities,
  );
}

export function scopeRemoteMarketplaceSync(
  service: IPluginSyncService,
  capabilities?: PluginMarketplaceCapabilities,
): IPluginSyncService {
  return guardRemoteMethods(
    service,
    ["exportMarketplaceSourceArchive", "importMarketplaceSourceArchive"],
    capabilities,
  );
}

export function scopeRemoteLegacyMarketplace(
  service: IPluginsService,
  capabilities?: PluginMarketplaceCapabilities,
): IPluginsService {
  return guardRemoteMethods(
    service,
    ["getOverview", "addMarketplace", "removeMarketplace", "updateMarketplace", "installPlugin"],
    capabilities,
  );
}
