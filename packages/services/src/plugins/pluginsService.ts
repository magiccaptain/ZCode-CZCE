import type { PluginScope, PluginsOverviewResult } from "@zcode/shared";
import type { IPluginsService } from "./plugins.js";

import {
  assertPluginMarketplaceEnabled,
  type PluginMarketplaceCapabilities,
} from "../pluginMarketplaceBoundary.js";

interface PluginsServiceOptions {
  productCapabilities?: PluginMarketplaceCapabilities;
  isDesktopRuntime?: boolean;
}

function createRetiredOverview(): PluginsOverviewResult {
  return {
    marketplaces: [],
    availablePlugins: [],
    installedPlugins: [],
    capability: { supported: false },
  };
}

function throwRetired(capabilities?: PluginMarketplaceCapabilities): never {
  assertPluginMarketplaceEnabled(capabilities);
  throw new Error("Legacy plugin management has been retired in ZCode Agent mode");
}

export function createPluginsService(options?: PluginsServiceOptions): IPluginsService {
  const throwRetiredPluginManagement = () => throwRetired(options?.productCapabilities);
  return {
    async getOverview(_params: {
      workspacePath: string;
      workspaceIdentity?: string;
    }): Promise<PluginsOverviewResult> {
      assertPluginMarketplaceEnabled(options?.productCapabilities);
      return createRetiredOverview();
    },

    async addMarketplace(_params: {
      workspacePath: string;
      workspaceIdentity?: string;
      source: string;
    }): Promise<void> {
      throwRetiredPluginManagement();
    },

    async removeMarketplace(_params: {
      workspacePath: string;
      workspaceIdentity?: string;
      marketplace: string;
    }): Promise<void> {
      throwRetiredPluginManagement();
    },

    async updateMarketplace(_params: {
      workspacePath: string;
      workspaceIdentity?: string;
      marketplace?: string;
    }): Promise<void> {
      throwRetiredPluginManagement();
    },

    async installPlugin(_params: {
      workspacePath: string;
      workspaceIdentity?: string;
      pluginName: string;
      marketplace: string;
      scope?: PluginScope;
    }): Promise<void> {
      throwRetiredPluginManagement();
    },

    async uninstallPlugin(_params: {
      workspacePath: string;
      workspaceIdentity?: string;
      pluginName: string;
      marketplace: string;
      scope?: PluginScope;
    }): Promise<void> {
      throwRetiredPluginManagement();
    },

    async setPluginEnabled(_params: {
      workspacePath: string;
      workspaceIdentity?: string;
      pluginName: string;
      marketplace: string;
      scope?: PluginScope;
      nativeScope?: "user" | "project" | "local";
      enabled: boolean;
    }): Promise<void> {
      throwRetiredPluginManagement();
    },
  };
}
