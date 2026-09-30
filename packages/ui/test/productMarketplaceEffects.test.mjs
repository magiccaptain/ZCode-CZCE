import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(
  createRequire(new URL("../../desktop/package.json", import.meta.url)).resolve("tsup"),
);
const { build } = await import(pathToFileURL(require.resolve("esbuild")).href);
const files = [
  "root/useRootPlatformEffects.ts",
  "ConversationShareMenu.tsx",
  "settings/PluginStorePage.tsx",
  "hooks/usePluginStoreOrder.ts",
];
const names = new Map();
for (const file of files) {
  const source = await readFile(join(import.meta.dirname, "../src", file), "utf8");
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g,
  )) {
    const list = names.get(match[2]) ?? new Set();
    for (const raw of match[1].split(",")) {
      const name = raw
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if (name) list.add(name);
    }
    names.set(match[2], list);
  }
}
const outfile = join(import.meta.dirname, "../../desktop/.e2e-cache/ui-market-effects-test.mjs");
await mkdir(join(import.meta.dirname, "../../desktop/.e2e-cache"), { recursive: true });
await build({
  stdin: {
    contents: files.map((file) => `export * from '../src/${file}';`).join("\n"),
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  jsx: "automatic",
  plugins: [
    {
      name: "effect-ports",
      setup(builder) {
        builder.onResolve({ filter: /^react$|^@\// }, (args) => ({
          path: args.path,
          namespace: "ports",
        }));
        builder.onLoad({ filter: /.*/, namespace: "ports" }, (args) => {
          const special = {
            react:
              "export const useEffect=f=>globalThis.__marketEffects.push(f); export const useRef=v=>({current:globalThis.__marketRefs.length?globalThis.__marketRefs.shift():v}); export const useState=v=>[typeof v==='function'?v():v,()=>{}]; export const useCallback=f=>f; export const useMemo=f=>f();",
            "@/hooks/usePlatform.js":
              "export const usePlatform=()=>globalThis.__marketPlatform; export const useOptionalPlatform=usePlatform;",
            "@/hooks/useServices.js": "export const useServices=()=>globalThis.__marketServices;",
            "@/hooks/useWorkspaceServices.js":
              "export const useOptionalBaseWorkspaceServices=()=>globalThis.__marketServices;",
            "@/store/TabStoreProvider.js":
              "export const useTabStore=f=>f({tabs:[],activeTabId:null});",
            "@/store/zcodeSessionStore.js":
              "export const useZCodeSessionStore={getState:()=>({}),subscribe:()=>()=>{}};",
            "@/store/conversationShareSelectionStore.js":
              "export const useConversationShareSelectionStore=f=>f({drafts:{fixture:{scope:'partial'}},dockStates:{fixture:{publishing:false,publishedShareUrl:'old'}},setScope(){throw Error('selection admitted')},showTimeline(){throw Error('selection admitted')},finishSelection(){}});",
            "@/lib/pluginStoreNavigation.js":
              "export const consumePluginStoreOpenTarget=()=>{globalThis.__marketConsumed++; return null;};",
            "@/root/rootPlatformWorkspaceSync.js":
              "export const shouldPublishCompleteWorkspaceSnapshot=v=>v;",
            "@/logger.js": "export const logger={debug(){},info(){},warn(){},error(){}};",
            "@/i18n/IntlProvider.js":
              "export const useZCodeIntl=()=>({intl:{formatMessage:()=>''}});",
          }[args.path];
          return {
            loader: "js",
            contents:
              special ??
              [...(names.get(args.path) ?? [])]
                .map(
                  (name) => `export const ${name}=()=>{throw Error('unexpected port: ${name}')};`,
                )
                .join("\n"),
          };
        });
      },
    },
  ],
});
const { useRootPlatformEffects, ConversationShareMenu, PluginStorePage, usePluginStoreOrder } =
  await import(pathToFileURL(outfile).href);
function reset() {
  globalThis.__marketEffects = [];
  globalThis.__marketRefs = [];
  globalThis.__marketConsumed = 0;
  globalThis.__marketPlatform = {
    productCapabilities: { sharing: false, pluginMarketplace: false },
  };
  globalThis.__marketServices = {
    conversationShareService: new Proxy(
      {},
      {
        get() {
          throw Error("share service accessed");
        },
      },
    ),
    clientConfigService: {
      getSnapshot() {
        throw Error("market sort background request");
      },
    },
  };
}
test("real Root hook does not subscribe share deep link or resume old pending import", () => {
  reset();
  const pending = { shareCode: "old", status: "received", clientRequestId: "old" };
  globalThis.__marketRefs = [false, pending];
  const platform = new Proxy(globalThis.__marketPlatform, {
    get(target, key) {
      if (key === "onShareImport")
        return () => {
          throw Error("deep link registered");
        };
      if (key in target) return target[key];
      if (key === "setApplicationLocale") return async () => {};
      return () => () => {};
    },
  });
  useRootPlatformEffects({
    platform,
    tabs: [],
    isDesktop: true,
    canBootstrapInitialWorkspace: false,
    hasCompletedFullTabRestore: false,
    setIsBootstrappingInitialWorkspace() {},
    intl: {},
    totalUnreadTaskCount: 0,
  });
  for (const effect of globalThis.__marketEffects) effect();
  assert.equal(pending.status, "received");
});
test("direct market page mount/share component reject before market effects and old selection rendering", () => {
  reset();
  assert.equal(PluginStorePage({ workspacePath: "/fixture" }), null);
  assert.equal(globalThis.__marketConsumed, 1);
  assert.equal(ConversationShareMenu({ taskId: "fixture" }), null);
  assert.equal(globalThis.__marketEffects.length, 0);
});
test("market ordering hook refuses effect and explicit force refresh", async () => {
  reset();
  const order = usePluginStoreOrder(true);
  for (const effect of globalThis.__marketEffects) effect();
  await order.refresh(true);
  assert.equal(order.order, null);
});
