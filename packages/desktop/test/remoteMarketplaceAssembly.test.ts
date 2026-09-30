import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Event } from "@zcode/rpc";
import {
  IPluginManagementService,
  IPluginsService,
  IPluginSyncService,
  IZCodeAgentService,
  IModelSelectionService,
  createZCodeAgentConnectionScope,
  type IServiceAccessor,
} from "@zcode/services";
import { disposeServiceResourcesAndWait, setDataBaseDir } from "@zcode/services/node";
import { PLUGIN_MARKETPLACE_CAPABILITY_ENV } from "@zcode/shared";
import { createRemoteWorkspaceServiceCollection } from "../src/host/remoteWorkspaceServiceCollection.js";
import { DESKTOP_PRODUCT_CAPABILITIES } from "../src/main/productCapabilities.js";
import { createStdioServices } from "../../server/src/stdioServices.js";
import { pickRemoteRuntimeEnv } from "@zcode/server/remote";

const marketMethods = [
  "getPluginsOverview",
  "addPluginMarketplace",
  "removePluginMarketplace",
  "updatePluginMarketplace",
  "installPlugin",
  "updatePlugin",
  "validatePlugin",
  "describePlugin",
  "resolveSuggestedPluginReference",
] as const;

test("Desktop remote assembly rejects legacy market RPC before remote dispatch, preserving local routes and attachment modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-remote-market-"));
  setDataBaseDir(root);
  const calls: Array<[string, unknown]> = [];
  const remote = new Proxy(
    {},
    {
      get(_target, method) {
        if (method === "onAgentRuntimeLifecycle") return Event.None;
        if (String(method).startsWith("on")) return () => Event.None;
        return async (params: unknown) => {
          calls.push([String(method), params]);
          return { plugins: [], diagnostics: [] };
        };
      },
    },
  );
  const connectionServices = new Proxy(
    {},
    {
      get() {
        return remote;
      },
    },
  ) as IServiceAccessor;
  const services = createRemoteWorkspaceServiceCollection({
    productCapabilities: DESKTOP_PRODUCT_CAPABILITIES,
    connectionServices,
    clientConfigService: remote as never,
    parentPort: { postMessage() {}, on() {}, off() {} } as never,
    createReportingRemoteZCodeTaskService: (service) => service,
    createRemotePromptAttachmentTaskService: (service) => service,
    createRemotePromptAttachmentSessionService: (service) => service,
    promptAttachmentTransferService: remote as never,
    runtimePreferencesBridge: {
      onError(error) {
        throw error;
      },
    },
  });
  try {
    const target = { workspacePath: "/fixture", workspaceIdentity: "remote-fixture-identity" };
    for (const mode of ["desktop-continuous", "web-remote-replayable"] as const) {
      const scope = createZCodeAgentConnectionScope(services.get(IZCodeAgentService), {
        connectionId: mode,
        clientMode: mode,
      });
      for (const service of [
        services.get(IPluginManagementService),
        services.get(IZCodeAgentService),
        scope.service,
      ])
        for (const method of marketMethods)
          await assert.rejects(
            () => service[method](target as never),
            /PLUGIN_MARKETPLACE_UNAVAILABLE/,
          );
      await scope.dispose();
    }
    for (const method of [
      "getOverview",
      "addMarketplace",
      "removeMarketplace",
      "updateMarketplace",
      "installPlugin",
    ] as const)
      await assert.rejects(
        () => services.get(IPluginsService)[method](target as never),
        /PLUGIN_MARKETPLACE_UNAVAILABLE/,
      );
    for (const method of [
      "exportMarketplaceSourceArchive",
      "importMarketplaceSourceArchive",
    ] as const)
      await assert.rejects(
        () => services.get(IPluginSyncService)[method]({} as never),
        /PLUGIN_MARKETPLACE_UNAVAILABLE/,
      );
    assert.deepEqual(calls, []);
    await services.get(IZCodeAgentService).listPlugins(target);
    await services
      .get(IPluginManagementService)
      .restoreBuiltinPlugin({ ...target, pluginId: "builtin" });
    await services.get(IPluginSyncService).exportPluginsArchive({ pluginIds: ["installed"] });
    assert.deepEqual(
      calls.map(([name]) => name),
      ["listPlugins", "restoreBuiltinPlugin", "exportPluginsArchive"],
    );
    assert.equal((calls[1][1] as typeof target).workspaceIdentity, target.workspaceIdentity);
  } finally {
    await disposeServiceResourcesAndWait(services);
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
});

test("remote whitelist and real stdio assembly consume Desktop marketplace admission before resolving Agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-stdio-market-"));
  setDataBaseDir(root);
  const env = pickRemoteRuntimeEnv({
    [PLUGIN_MARKETPLACE_CAPABILITY_ENV]: "false",
    NOT_PUBLIC: "discard",
  });
  assert.deepEqual(env, { [PLUGIN_MARKETPLACE_CAPABILITY_ENV]: "false" });
  let commands = 0;
  const { services } = createStdioServices({
    env,
    zcodeBuiltinProviderConfigFilePath: fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    zcodeAgentCommandResolver: () => {
      commands++;
      throw Error("must not resolve");
    },
  });
  try {
    await services.get(IModelSelectionService).getView();
    for (const service of [
      services.get(IZCodeAgentService),
      services.get(IPluginManagementService),
    ])
      for (const method of marketMethods)
        await assert.rejects(
          () => service[method]({ workspacePath: root } as never),
          /PLUGIN_MARKETPLACE_UNAVAILABLE/,
        );
    await assert.rejects(
      () =>
        services
          .get(IPluginSyncService)
          .importMarketplaceSourceArchive({ archive: new Uint8Array() }),
      /PLUGIN_MARKETPLACE_UNAVAILABLE/,
    );
    assert.equal(commands, 0);
  } finally {
    await disposeServiceResourcesAndWait(services);
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
});

test("independent stdio without Desktop capability preserves original marketplace admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-stdio-default-"));
  setDataBaseDir(root);
  let commands = 0;
  const { services } = createStdioServices({
    env: {},
    zcodeBuiltinProviderConfigFilePath: fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    zcodeAgentCommandResolver: () => {
      commands++;
      throw Error("original command resolution");
    },
  });
  try {
    await services.get(IModelSelectionService).getView();
    await assert.rejects(
      () =>
        services
          .get(IPluginManagementService)
          .addPluginMarketplace({ workspacePath: root, source: "http://127.0.0.1:1/fixture" }),
      /original command resolution/,
    );
    assert.equal(commands, 1);
  } finally {
    await disposeServiceResourcesAndWait(services);
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
});
