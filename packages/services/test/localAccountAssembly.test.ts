import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createCredentialService,
  createLocalServices,
  disposeServiceResourcesAndWait,
  getAccountRequestAuthService,
  getProviderProvisioningSource,
  getAppConfigDir,
  setDataBaseDir,
} from "../src/node.js";
import {
  ICredentialService,
  IOAuthService,
  IModelSelectionService,
  IProviderSettingsService,
  ICodingPlanSubscriptionService,
  IUsageStatsService,
  IProviderProvisioningTargetService,
  IOffPeakTaskService,
  ISettingService,
} from "../src/index.js";

const builtinFilePath = fileURLToPath(
  new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
);

test("Desktop assembly preserves old account data, excludes account models and keeps local API/MCP credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-disabled-account-assembly-"));
  setDataBaseDir(dir);
  let services: ReturnType<typeof createLocalServices> | undefined;
  const requests: string[] = [];
  let provisionChanges = 0;
  try {
    const configDir = getAppConfigDir();
    await mkdir(configDir, { recursive: true });
    const legacyPath = join(configDir, "config.json");
    const legacyContent = JSON.stringify({
      provider: {
        "custom-fixture": {
          name: "Local fixture",
          npm: "@ai-sdk/openai-compatible",
          enabled: true,
          options: { baseURL: "https://provider.example/v1", apiKey: "fixture-only-key" },
          models: { "fixture-model": { limit: { context: 32000 } } },
        },
      },
    });
    await writeFile(legacyPath, legacyContent);
    const credentialService = createCredentialService();
    for (const [key, value] of Object.entries({
      "oauth:active_provider": "bigmodel",
      "oauth:bigmodel:access_token": "expired-fixture-token",
      "oauth:bigmodel:user_info": "corrupt-old-profile",
      zcodejwttoken: "expired-fixture-jwt",
      "mcp:fixture": "fixture-mcp-key",
    }))
      await credentialService.save(key, value);
    const credentialPath = join(configDir, "credentials.json");
    const beforeCredentials = await readFile(credentialPath, "utf8");
    const oldSettings = {
      providerFamilyDomain: "bigmodel" as const,
      providerFamilyConnectionSelections: {},
    };
    const options: Parameters<typeof createLocalServices>[0] = {
      productCapabilities: {
        productAccount: false,
        productSubscription: false,
        appUpdates: false,
        telemetry: false,
      },
      zcodeBuiltinProviderConfigFilePath: builtinFilePath,
      serviceAuthorityMode: "desktop-local",
      providerProvisioningTargetEnabled: true,
      prepareLegacyAccountConnections: async () => {
        throw new Error("old account migration must not run");
      },
      settingService: {
        get: async () => oldSettings,
        update: async () => {},
        updateDataBaseDir: async () => {},
        ensureDefaultProject: async () => ({ path: dir, created: false }),
      },
      hostApiNetworkTransport: {
        fetch: async (input) => {
          requests.push(String(input));
          return new Response("not found", { status: 404 });
        },
        dispose() {},
        disposeAndWait: async () => {},
      },
      onProviderProvisioningSourceChanged: () => {
        provisionChanges += 1;
      },
    };
    services = createLocalServices(options);
    const models = await services.get(IModelSelectionService).getView();
    assert(models.providers.some((provider) => provider.providerId === "custom-fixture"));
    assert(models.providers.every((provider) => provider.config.access?.type !== "zhipu-account"));
    const localProvider = models.providers.find(
      (provider) => provider.providerId === "custom-fixture",
    )!;
    assert.equal(localProvider.config.access?.apiKey, "fixture-only-key");
    assert.deepEqual(
      localProvider.models.map((model) => model.modelId),
      ["fixture-model"],
    );
    assert.equal(await services.get(IOAuthService).restoreSession(), null);
    assert.deepEqual(await services.get(IOAuthService).restoreCachedSessionState(), {
      status: "signed-out",
    });
    await assert.rejects(
      () => services!.get(IOAuthService).handleCallback("zcode://oauth/callback?code=old"),
      /PRODUCT_ACCOUNT_UNAVAILABLE/,
    );
    await assert.rejects(
      () => services!.get(ICodingPlanSubscriptionService).getStaticProducts(),
      /PRODUCT_SUBSCRIPTION_UNAVAILABLE/,
    );
    await assert.rejects(
      () => services!.get(IUsageStatsService).getEntitlementSnapshot(),
      /PRODUCT_SUBSCRIPTION_UNAVAILABLE/,
    );
    await assert.rejects(
      () => getAccountRequestAuthService(services!)!.resolveCurrent({} as never),
      /PRODUCT_ACCOUNT_UNAVAILABLE/,
    );
    await assert.rejects(
      () => getProviderProvisioningSource(services!)!.read("old-sync"),
      /PRODUCT_ACCOUNT_UNAVAILABLE/,
    );
    assert.equal(services.getOptional(IProviderProvisioningTargetService), undefined);
    assert.deepEqual(await services.get(IOffPeakTaskService).getCodingPlanSupport(), {
      supported: false,
      reason: "connection_unavailable",
    });
    await (services.get(IOffPeakTaskService) as { runSyncCycle(): Promise<void> }).runSyncCycle();
    assert.equal(await readFile(credentialPath, "utf8"), beforeCredentials);
    assert.equal(await readFile(legacyPath, "utf8"), legacyContent);
    assert.deepEqual(await services.get(ISettingService).get(), oldSettings);
    assert.equal(await services.get(ICredentialService).load("mcp:fixture"), "fixture-mcp-key");
    await services.get(ICredentialService).save("mcp:second", "fixture-second-key");
    await services
      .get(ICredentialService)
      .save("oauth:bigmodel:access_token", "replacement-old-token");
    await services.get(IProviderSettingsService).savePersonalProviderOverlay("custom-fixture", {
      ...localProvider.config,
      access: { type: "api-key", apiKey: "fixture-updated-key" },
    });
    await services.get(ISettingService).update({ providerFamilyDomain: "zai" });
    assert.equal(
      provisionChanges,
      0,
      "no credential/personal/account-settings provisioning triggers",
    );
    // 普通 catalog 网络失败保持既有错误；关闭产品账号不能吞掉 Provider 侧错误。
    await assert.rejects(
      () => services!.get(IProviderSettingsService).refresh("manual-local-refresh"),
      /HTTP 404/,
    );
    assert(
      (await services.get(IModelSelectionService).getView()).providers.some(
        (provider) => provider.providerId === "custom-fixture",
      ),
    );
    await disposeServiceResourcesAndWait(services);
    services = undefined;
    services = createLocalServices(options);
    const restarted = await services.get(IModelSelectionService).getView();
    assert(
      restarted.providers.every((provider) => provider.config.access?.type !== "zhipu-account"),
    );
    assert.equal(
      restarted.providers.find((provider) => provider.providerId === "custom-fixture")?.config
        .access?.apiKey,
      "fixture-updated-key",
    );
    assert.equal(await services.get(ICredentialService).load("mcp:second"), "fixture-second-key");
    assert.equal(await services.get(IOAuthService).restoreSession(), null);
    assert(
      requests.every((url) => new URL(url).pathname === "/api/v1/client/configs"),
      `only generic catalog/config requests: ${requests.join(", ")}`,
    );
  } finally {
    if (services) await disposeServiceResourcesAndWait(services);
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
