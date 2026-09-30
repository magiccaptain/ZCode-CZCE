import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IConversationShareService,
  IModelSelectionService,
  IPluginManagementService,
  IPluginsService,
  IPluginSyncService,
  IZCodeAgentService,
} from "@zcode/services";
import {
  createLocalServices,
  disposeServiceResourcesAndWait,
  setDataBaseDir,
} from "@zcode/services/node";
import { DESKTOP_PRODUCT_CAPABILITIES } from "../src/main/productCapabilities.js";
import { scopeConversationShareServiceForAttachment } from "../src/host/conversationShareAttachmentService.js";

test("Desktop same-owner assembly rejects marketplace/share across registered services and attachment", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-market-share-assembly-"));
  setDataBaseDir(root);
  const requests: string[] = [];
  let commands = 0;
  let services: ReturnType<typeof createLocalServices> | undefined;
  try {
    services = createLocalServices({
      productCapabilities: DESKTOP_PRODUCT_CAPABILITIES,
      serviceAuthorityMode: "desktop-local",
      zcodeBuiltinProviderConfigFilePath: fileURLToPath(
        new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
      ),
      runtimeProcessEnvPatch: {},
      zcodeAgentCommandResolver: () => {
        commands++;
        throw new Error("Disabled requests must not resolve an Agent command");
      },
      hostApiNetworkTransport: {
        fetch: async (input) => {
          requests.push(String(input));
          return new Response("not found", { status: 404 });
        },
        dispose() {},
        disposeAndWait: async () => {},
      },
      settingService: {
        get: async () => ({ providerFamilyDomain: "bigmodel" }),
        update: async () => {},
        updateDataBaseDir: async () => {},
        ensureDefaultProject: async () => ({ path: root, created: false }),
      },
    });
    // 等待原 Provider owner 初始化，避免测试提前 teardown 与它的异步文件写入竞争。
    await services.get(IModelSelectionService).getView();
    const target = { workspacePath: root, workspaceIdentity: "fixture-identity" };
    for (const service of [
      services.get(IPluginManagementService),
      services.get(IZCodeAgentService),
    ]) {
      for (const method of [
        "getPluginsOverview",
        "addPluginMarketplace",
        "removePluginMarketplace",
        "updatePluginMarketplace",
        "installPlugin",
        "updatePlugin",
        "validatePlugin",
        "describePlugin",
        "resolveSuggestedPluginReference",
      ] as const)
        await assert.rejects(
          () => service[method](target as never),
          /PLUGIN_MARKETPLACE_UNAVAILABLE/,
        );
    }
    await assert.rejects(
      () => services!.get(IPluginsService).getOverview(target),
      /PLUGIN_MARKETPLACE_UNAVAILABLE/,
    );
    await assert.rejects(
      () =>
        services!.get(IPluginSyncService).exportMarketplaceSourceArchive({
          marketplaceId: "old",
          pluginNames: ["old"],
          source: { source: "file", path: "/missing" },
        }),
      /PLUGIN_MARKETPLACE_UNAVAILABLE/,
    );
    await assert.rejects(
      () =>
        services!
          .get(IPluginSyncService)
          .importMarketplaceSourceArchive({ archive: new Uint8Array([0]) }),
      /PLUGIN_MARKETPLACE_UNAVAILABLE/,
    );
    const sharing = services.get(IConversationShareService);
    for (const service of [
      sharing,
      scopeConversationShareServiceForAttachment(
        sharing,
        "desktop-continuous",
        undefined,
        DESKTOP_PRODUCT_CAPABILITIES,
      ),
      scopeConversationShareServiceForAttachment(
        sharing,
        "web-remote-replayable",
        undefined,
        DESKTOP_PRODUCT_CAPABILITIES,
      ),
    ]) {
      for (const request of [
        () => service.getCapabilities(),
        () => service.preflight({ ...target, sessionId: "old", selection: { kind: "all" } }),
        () =>
          service.publish(
            {
              ...target,
              sessionId: "old",
              title: "Fixture",
              accessMode: "public_importable",
              selection: { kind: "all" },
              clientRequestId: "old",
              disclosureAcceptedAt: 1,
            },
            "old",
          ),
        () => service.getPreview("old"),
        () => service.getContinuation({ shareCode: "old", clientRequestId: "old" }),
        () =>
          service.importShare(
            { shareCode: "old", clientRequestId: "old", targetWorkspacePath: root },
            "old",
          ),
      ])
        await assert.rejects(request, {
          kind: "feature_disabled",
          message: "Conversation sharing is unavailable in this product",
        });
    }
    assert.equal(commands, 0);
    // 通用配置 catalog 仍允许联网；只核验它未被误计成市场/分享执行。
    assert(requests.every((url) => new URL(url).pathname === "/api/v1/client/configs"));
  } finally {
    if (services) await disposeServiceResourcesAndWait(services);
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
});
