import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(
  createRequire(new URL("../../desktop/package.json", import.meta.url)).resolve("tsup"),
);
const { build } = await import(pathToFileURL(require.resolve("esbuild")).href);
const outfile = join(import.meta.dirname, "../../desktop/.e2e-cache/ui-account-test.mjs");
await mkdir(join(import.meta.dirname, "../../desktop/.e2e-cache"), { recursive: true });
await build({
  stdin: {
    contents:
      "export * from '../src/root/useRootOAuthEffects.ts'; export * from '../src/hooks/useOAuth.ts'; export * from '../src/hooks/useTokenRefresh.ts'; export * from '../src/hooks/useUsageEntitlement.ts';",
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "effect-ports",
      setup(builder) {
        builder.onResolve(
          { filter: /^react$|^@\/|useServices\.js$|usePlatform\.js$|logger\.js$/ },
          (args) => ({ path: args.path, namespace: "ports" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "ports" }, (args) => ({
          loader: "js",
          contents:
            args.path === "react"
              ? "export const useRef=v=>({current:v}); export const useEffect=(f)=>globalThis.__effects.push(f); export const useState=v=>[typeof v==='function'?v():v,()=>{}]; export const useCallback=f=>f; export const useMemo=f=>f();"
              : args.path.endsWith("useStableAccountAccess.js")
                ? "export const useStableAccountAccess=v=>v;"
                : args.path.endsWith("useWorkspaceServices.js")
                  ? "export const useOptionalBaseWorkspaceServices=()=>null;"
                  : args.path.endsWith("usageEntitlementCache.js")
                    ? "export const readCachedUsageEntitlementSnapshot=()=>{throw Error('old entitlement cache read')}; export const writeCachedUsageEntitlementSnapshot=()=>{throw Error('cache write')};"
                    : args.path.endsWith("usageEntitlementRefreshPolicy.js")
                      ? 'export const buildEntitlementFreshnessKey=()=>"fixture"; export const USAGE_ENTITLEMENT_ACCESS_REFRESH_MS=1000; ' +
                        [
                          "hasSharedEntitlementFailure",
                          "beginSharedEntitlementRequest",
                          "publishSharedEntitlementSnapshot",
                          "readSharedEntitlementSnapshot",
                          "recordSharedEntitlementAccess",
                          "recordSharedEntitlementFailure",
                          "shouldDeferSharedEntitlementRefresh",
                          "shouldDeferSharedEntitlementAccess",
                          "shouldUseSharedEntitlementSnapshot",
                          "subscribeSharedEntitlementSnapshot",
                        ]
                          .map(
                            (name) =>
                              `export const ${name}=()=>{throw Error('unexpected entitlement IO')};`,
                          )
                          .join("\n")
                      : args.path.endsWith("usePlatform.js")
                        ? "export const usePlatform=()=>globalThis.__accountPlatform; export const useOptionalPlatform=usePlatform;"
                        : args.path.endsWith("useServices.js")
                          ? "export const useServices=()=>globalThis.__accountServices;"
                          : args.path.endsWith("StoreProvider.js")
                            ? "export const useZCodeStore=selector=>selector({setOAuthPollingActive:()=>{}});"
                            : args.path.endsWith("useAccountConnectionLossNotification.js")
                              ? "export const useAccountConnectionLossNotification=(...args)=>{if(args[3]!==false)throw Error('account observer started')};"
                              : args.path.endsWith("useAlertDialog.js")
                                ? "export const useAlertDialog=()=>()=>{throw Error('login alert')};"
                                : args.path.endsWith("IntlProvider.js")
                                  ? "export const useZCodeIntl=()=>({intl:{formatMessage:()=>''}});"
                                  : args.path.endsWith("logger.js")
                                    ? "export const logger={info(){},warn(){},error(){}};"
                                    : "export const reportAppTelemetryEvent=()=>{}; export const resolveProviderTelemetryLabel=()=>null; export const setProviderFamilyDomain=()=>{}; export const refreshLatestModelProviderFamilySelectionAfterLogin=()=>{}; export const refreshRestoredOAuthProviderFamilyAfterStartup=()=>{}; export const applyCachedOAuthSessionRestoreResult=()=>{}; export const markZcodeJwtInvalidRestart=()=>{}; export const shouldApplyOAuthPollingFailure=()=>false;",
        }));
      },
    },
  ],
});
const { useRootOAuthEffects, useOAuth, useTokenRefresh, useUsageEntitlementWithService } =
  await import(pathToFileURL(outfile).href);
test("Root disabled account does not restore, poll, subscribe JWT or deep link; renderer ready survives", async () => {
  globalThis.__effects = [];
  let ready = 0;
  let restoring;
  let user;
  const forbidden = new Proxy(
    {},
    {
      get(_target, key) {
        throw Error(`unexpected account IO: ${String(key)}`);
      },
    },
  );
  useRootOAuthEffects({
    accountIntentKey: "old-account",
    platform: {
      productCapabilities: { productAccount: false },
      notifyRendererReady() {
        ready++;
      },
      onOAuthCallback: forbidden,
    },
    services: forbidden,
    refreshProviderState: forbidden,
    setUser(value) {
      user = value;
    },
    setIsRestoringOAuthSession(value) {
      restoring = value;
    },
    setOAuthError() {},
    oauthPollingActive: true,
    setOAuthPollingActive() {},
    markOAuthSuccess() {},
    onReauthenticationRequired() {
      assert.fail("reauthentication");
    },
  });
  for (const effect of globalThis.__effects) effect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ready, 1);
  assert.equal(restoring, false);
  assert.equal(user, null);
  delete globalThis.__effects;
});

test("Old provider login and root refresh commands cannot call OAuth or open an external browser", async () => {
  globalThis.__effects = [];
  globalThis.__accountPlatform = {
    productCapabilities: { productAccount: false },
    openExternal() {
      assert.fail("browser opened");
    },
  };
  globalThis.__accountServices = {
    oauthService: new Proxy(
      {},
      {
        get() {
          assert.fail("OAuth method accessed");
        },
      },
    ),
  };
  const login = useOAuth();
  for (const effect of globalThis.__effects) effect();
  await login.startLogin("bigmodel");
  const refresh = useTokenRefresh();
  assert.equal(await refresh.tryRefresh(), false);
  await refresh.clearCredentials();
  delete globalThis.__effects;
  delete globalThis.__accountServices;
  delete globalThis.__accountPlatform;
});

test("Disabled subscription cannot read old entitlement caches, subscribe, refresh or call usage service", async () => {
  for (const productCapabilities of [{ productAccount: false }, { productSubscription: false }]) {
    globalThis.__effects = [];
    globalThis.__accountPlatform = { productCapabilities };
    const usage = new Proxy(
      {},
      {
        get() {
          assert.fail("usage service called");
        },
      },
    );
    const entitlement = useUsageEntitlementWithService(usage, {
      enabled: true,
      refreshOnMount: true,
      cacheKey: "old-account",
      includeSubscription: true,
    });
    for (const effect of globalThis.__effects) effect();
    await entitlement.refresh({ force: true });
    assert.equal(entitlement.snapshot, null);
    assert.equal(entitlement.loading, false);
    assert.equal(entitlement.error, null);
  }
  delete globalThis.__effects;
  delete globalThis.__accountPlatform;
});
