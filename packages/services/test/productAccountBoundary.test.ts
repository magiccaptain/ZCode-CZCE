import assert from "node:assert/strict";
import test from "node:test";
import { OAuthService } from "../src/oauth/oauthService.js";
import { createCodingPlanSubscriptionService } from "../src/coding-plan-subscription/codingPlanSubscriptionService.js";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";
import { createAccountProviderCredentialService } from "../src/model-provider/accountProviderCredentialService.js";
import { AccountProviderApiClient } from "../src/model-provider/accountProviderApiClient.js";
import { createAccountRequestAuthService } from "../src/model-provider/accountRequestAuthService.js";
import { createProviderProvisioningSource } from "../src/model-provider/providerProvisioningSource.js";
import { OffPeakTaskService } from "../src/session/offPeakTaskService.js";
import { resolveOfficialMcpCredentials } from "../src/official-mcp/officialMcpCredentials.js";
import { createFeedbackService } from "../src/feedback/feedbackService.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataBaseDir } from "../src/paths.js";

const productCapabilities = Object.freeze({
  productAccount: false,
  productSubscription: false,
  appUpdates: false,
});
function forbidden(): never {
  throw new Error("unexpected IO: old account credential or network");
}
const credentials = { load: forbidden, save: forbidden, delete: forbidden };
const apiClient = { request: forbidden };

test("disabled OAuth ignores old valid/expired/corrupt tokens and rejects every bypass without IO", async () => {
  const service = new OAuthService(credentials, { productCapabilities, adapters: [], apiClient });
  assert.deepEqual(await service.getProviders(), []);
  assert.equal(await service.getActiveProvider(), null);
  assert.equal(await service.restoreCachedSession(), null);
  assert.deepEqual(await service.restoreCachedSessionState(), { status: "signed-out" });
  assert.equal(await service.restoreSession(), null);
  for (const command of [
    () => service.startOAuth("bigmodel"),
    () => service.startOAuthWithPolling("zai"),
    () => service.handleCallback("zcode://oauth/callback?state=old&code=old"),
    () => service.pollPendingOAuth(),
    () => service.refreshToken(),
    () => service.logout(),
    () => service.logoutAll(),
  ])
    await assert.rejects(command, /PRODUCT_ACCOUNT_UNAVAILABLE/);
  await service.cancelPending();
  assert.equal(
    await service.logoutIfCurrentCredentialRequest("https://example.invalid", new Headers()),
    false,
  );
});

test("disabled credential, account API, request auth and provisioning stop before cache/network/persistence", async () => {
  const service = createAccountProviderCredentialService({
    productCapabilities,
    credentialStore: { loadApiKey: forbidden, saveApiKey: forbidden, deleteApiKey: forbidden },
    loadOAuthAccessToken: forbidden,
    resolveProviderApiKey: forbidden,
  });
  for (const forceRefresh of [false, true])
    assert.equal(
      await service.loadCodingPlanApiKey({
        providerId: "fixture",
        family: "bigmodel",
        accountIdentity: "old-account",
        forceRefresh,
      }),
      null,
    );
  await assert.rejects(
    () =>
      new AccountProviderApiClient(apiClient, productCapabilities).fetchRemoteData(
        "https://example.invalid",
        {},
      ),
    /PRODUCT_ACCOUNT_UNAVAILABLE/,
  );
  const auth = createAccountRequestAuthService(
    { resolveAccessCurrent: forbidden, resolveCurrent: forbidden, assertCurrent: forbidden },
    productCapabilities,
  );
  assert.equal(await auth.resolveAccessCurrent({} as never), null);
  await assert.rejects(() => auth.resolveCurrent({} as never), /PRODUCT_ACCOUNT_UNAVAILABLE/);
  await assert.rejects(() => auth.assertCurrent({} as never), /PRODUCT_ACCOUNT_UNAVAILABLE/);
  const source = createProviderProvisioningSource({
    productCapabilities,
    personalRepository: { read: forbidden } as never,
    settingService: { get: forbidden } as never,
    credentialFilePath: "/not-read",
    personalConfigFilePath: "/not-read",
  });
  await assert.rejects(() => source.read("old-sync"), /PRODUCT_ACCOUNT_UNAVAILABLE/);
});

test("disabled subscription refuses every product method while keeping fixed budget and no update fetch", async () => {
  const service = createCodingPlanSubscriptionService({
    productCapabilities,
    apiClient,
    credentialService: credentials,
  });
  const generic = new Set([
    "getModelContextBudgetStrategy",
    "getDynamicWorkflowClientConfig",
    "getForceUpdateConfig",
    "getOffPeakClientConfig",
  ]);
  for (const [name, command] of Object.entries(service)) {
    if (generic.has(name)) continue;
    await assert.rejects(() => command({} as never), /PRODUCT_SUBSCRIPTION_UNAVAILABLE/, name);
  }
  assert.equal(await service.getModelContextBudgetStrategy(), "preflight-v1");
  assert.equal(await service.getForceUpdateConfig(), null);
  const previous = process.env.ZCODE_OFFPEAK_MOCK;
  process.env.ZCODE_OFFPEAK_MOCK = "1";
  try {
    assert.deepEqual(await service.getOffPeakClientConfig(), {
      enabled: false,
      modelSelectionView: { revision: 0, providers: [] },
    });
  } finally {
    if (previous === undefined) delete process.env.ZCODE_OFFPEAK_MOCK;
    else process.env.ZCODE_OFFPEAK_MOCK = previous;
  }
});

test("disabled product usage rejects monitor/reset/entitlement but preserves Agent local usage", async () => {
  const local = { source: "fixture" };
  const service = createUsageStatsService({
    productCapabilities,
    apiClient,
    credentialService: credentials,
    accountRequestAuthService: {
      resolveAccessCurrent: forbidden,
      resolveCurrent: forbidden,
      assertCurrent: forbidden,
    },
    zcodeAgentService: { getAppUsageStats: async () => local as never },
  });
  for (const [name, command] of Object.entries(service)) {
    if (name === "getAppUsageSnapshot") continue;
    await assert.rejects(() => command({} as never), /PRODUCT_SUBSCRIPTION_UNAVAILABLE/, name);
  }
  assert.equal(
    await service.getAppUsageSnapshot({ range: "day", timeZone: "UTC" } as never),
    local,
  );
});

test("disabled product-account MCP headers never read old account identity or JWT", async () => {
  assert.deepEqual(
    await resolveOfficialMcpCredentials({
      productCapabilities,
      credentialService: credentials,
      accountRequestAuthService: { resolveAccessCurrent: forbidden },
      modelSelectionService: { getView: forbidden },
    }),
    { ok: false, reason: "official_auth_unavailable" },
  );
});

test("feedback keeps anonymous local listing without restoring product JWT", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-feedback-no-account-"));
  setDataBaseDir(dir);
  try {
    const service = createFeedbackService({
      productCapabilities,
      credentialService: credentials,
      apiClient,
      oauthService: {} as never,
      getDeviceMid: () => "fixture-device",
    });
    assert.deepEqual(await service.list({}), { items: [], total: 0 });
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("disabled Off-Peak cannot sync old outbox, create, continue, dispatch or use mock eligibility", async () => {
  const service = new OffPeakTaskService({
    productCapabilities,
    repo: new Proxy({}, { get: () => forbidden }) as never,
    client: new Proxy({}, { get: () => forbidden }) as never,
    resolveCodingPlanSupport: forbidden,
    resolveTelemetryProviderName: forbidden,
    resolveModelSelection: forbidden,
    logger: {} as never,
  });
  service.startSync();
  await service.runSyncCycle();
  assert.deepEqual(await service.getCodingPlanSupport(), {
    supported: false,
    reason: "connection_unavailable",
  });
  assert.equal(await service.validateDispatchModelSelection({} as never), false);
  assert.deepEqual(await service.createTask({} as never), {
    ok: false,
    failureStage: "client_validation",
    errorCategory: "client_validation",
    errorCode: "PRODUCT_SUBSCRIPTION_UNAVAILABLE",
    providerName: "",
  });
  for (const command of [
    () => service.continueTask("old"),
    () => service.getTakeNumberAvailability(),
    () => service.cancelTask("old"),
    () => service.handleTicketExpiredDuringRun("old"),
  ]) {
    await assert.rejects(command, /PRODUCT_SUBSCRIPTION_UNAVAILABLE/);
  }
  service.disposeAll();
});

test("non-Desktop factories retain default account/cache behavior when capabilities are absent", async () => {
  const service = createAccountProviderCredentialService({
    credentialStore: {
      loadApiKey: async () => "fixture-cached",
      saveApiKey: forbidden,
      deleteApiKey: forbidden,
    },
    loadOAuthAccessToken: forbidden,
    resolveProviderApiKey: forbidden,
  });
  assert.equal(
    await service.loadCodingPlanApiKey({
      providerId: "fixture",
      family: "bigmodel",
      accountIdentity: "fixture-account",
    }),
    "fixture-cached",
  );
  const oauth = new OAuthService(
    { ...credentials, load: async (key) => (key === "oauth:active_provider" ? "bigmodel" : null) },
    { adapters: [] },
  );
  assert.equal(await oauth.getActiveProvider(), "bigmodel");
  const api = new AccountProviderApiClient({
    request: async () => new Response(JSON.stringify({ code: 200, data: { fixture: true } })),
  });
  assert.deepEqual(await api.fetchRemoteData("https://example.invalid", {}), { fixture: true });
});

test("dynamic workflow generic config remains available without product account credential/header access", async () => {
  let calls = 0;
  const previous = process.env.ZCODE_DYNAMIC_WORKFLOW_MODE;
  delete process.env.ZCODE_DYNAMIC_WORKFLOW_MODE;
  try {
    const service = createCodingPlanSubscriptionService({
      productCapabilities,
      credentialService: credentials,
      apiClient: {
        request: async (input, init) => {
          calls += 1;
          assert.equal(new URL(String(input)).pathname, "/api/v1/client/configs");
          assert.equal(new Headers(init?.headers).has("Authorization"), false);
          return new Response(
            JSON.stringify({
              code: 0,
              data: { configs: { dynamicWorkflow: { mode: "onDemand" } } },
            }),
          );
        },
      },
    });
    const view = await service.getDynamicWorkflowClientConfig();
    assert.equal(view.mode, "onDemand");
    assert.equal(view.source, "remote");
    assert.equal(calls, 1);
    await assert.rejects(() => service.getStaticProducts(), /PRODUCT_SUBSCRIPTION_UNAVAILABLE/);
    assert.equal(calls, 1, "cached generic config cannot restore product subscriptions");
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DYNAMIC_WORKFLOW_MODE;
    else process.env.ZCODE_DYNAMIC_WORKFLOW_MODE = previous;
  }
});
