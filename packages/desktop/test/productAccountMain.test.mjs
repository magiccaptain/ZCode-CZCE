import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PlatformChannels } from "@zcode/shared";

const require = createRequire(import.meta.url);
const buildRequire = createRequire(require.resolve("tsup"));
const { build } = await import(pathToFileURL(buildRequire.resolve("esbuild")).href);
const cache = join(import.meta.dirname, "../.e2e-cache");
await mkdir(cache, { recursive: true });
const outfile = join(cache, "product-account-main-test.mjs");
const listeners = new Map();
const warnings = [];
const opened = [];
const delivered = [];
const appListeners = new Map();
const sender = {
  id: 1,
  getURL: () => "file:///fixture",
  send: (...args) => delivered.push(args),
  loadURL: () => assert.fail("product guest navigation"),
};
globalThis.__accountMainPorts = {
  ipcMain: { on: (name, fn) => listeners.set(name, fn), handle() {} },
  app: { on: (name, fn) => appListeners.set(name, fn) },
  shell: { openExternal: async (url) => opened.push(url) },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showMessageBoxSync: () => assert.fail("dialog") },
};
await build({
  stdin: {
    contents:
      "export * from '../src/main/desktopMainIpcRemote.ts'; export * from '../src/main/desktopOAuthDeepLink.ts';",
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
      name: "native-ports",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^electron$|\.\/(desktopArmsRum|desktopNotifications|desktopArmsCustomEvent|desktopRemoteUsageArmsTelemetry|desktopMainIpcHelpers|desktopLinuxDeepLinkRegistration)\.js$/,
          },
          (args) => ({ path: args.path, namespace: "port" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "port" }, ({ path }) => ({
          loader: "js",
          contents:
            path === "electron"
              ? "export const {ipcMain,app,shell,BrowserWindow,dialog}=globalThis.__accountMainPorts;"
              : "export const configureRemoteUsageArmsTelemetry=()=>{}; export const getDesktopArmsRum=()=>{throw Error('SDK')}; export const dispatchTaskNotification=()=>{}; export const dispatchFinalArmsCustomEvent=()=>{}; export const enableSharedFinalArmsCustomEventE2EController=()=>{}; export const reportRemoteConnectResultToArms=()=>{}; export const openPathInDefaultApp=()=>{}; export const registerLinuxDeepLinkProtocol=()=>{};",
        }));
      },
    },
  ],
});
const main = await import(pathToFileURL(outfile).href);
const logger = { info() {}, warn: (...args) => warnings.push(args), error() {} };
main.registerRemoteIpcHandlers({
  logger,
  appTelemetryRuntime: {
    onRendererReady: ({ hasPendingOAuthCallback }) => assert.equal(hasPendingOAuthCallback, false),
    onOAuthCallbackHandled: () => assert.fail("account callback refresh"),
  },
  onOAuthCallbackHandledSideEffect: () => assert.fail("account identity refresh"),
});

test("Main rejects old product states and callbacks without pending replay or refresh", () => {
  assert.throws(
    () => main.registerOAuthState(1, { state: "fixture" }),
    /PRODUCT_ACCOUNT_UNAVAILABLE/,
  );
  listeners.get(PlatformChannels.OAuthRegisterState)({ sender }, { state: "fixture" });
  for (const url of [
    "zcode://oauth/callback?state=fixture&code=fixture",
    "zcode:/oauth/callback?state=fixture",
    "zcode://payment/callback?order=fixture",
  ]) {
    assert.equal(main.handleDeepLink(url, logger), false);
  }
  listeners.get(PlatformChannels.OAuthCallbackHandled)({ sender });
  listeners.get(PlatformChannels.RendererReady)({ sender });
  assert.deepEqual(delivered, []);
  assert(warnings.some((entry) => entry.includes("PRODUCT_ACCOUNT_UNAVAILABLE")));
  assert(warnings.some((entry) => entry.includes("PRODUCT_SUBSCRIPTION_UNAVAILABLE")));
});

test("Main blocks only product external intents, preserving MCP OAuth, Provider pages and browser", async () => {
  const productRedirect =
    "https://zcode.z.ai/app/oauth/login?redirect=zcode%3A%2F%2Foauth%2Fcallback";
  const blocked = [
    productRedirect,
    `https://chat.z.ai/api/oauth/authorize?redirect_uri=${encodeURIComponent(productRedirect)}`,
    "https://bigmodel.cn/login",
    "https://zcode.z.ai/coding-plan?embedded=app",
  ];
  for (const url of blocked) listeners.get(PlatformChannels.OpenExternal)({ sender }, url);
  listeners.get(PlatformChannels.OpenExternal)(
    { sender },
    {
      sourceUrl: "https://zcode.z.ai/coding-plan?embedded=app",
      url: "https://www.paypal.com/fixture",
    },
  );
  assert.deepEqual(opened, []);
  const allowed = [
    "https://fixture.invalid/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback",
    "https://chat.z.ai/api/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback",
    "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    "https://zcode.z.ai/docs",
    "https://www.paypal.com/",
    "https://fixture.invalid/billing",
  ];
  for (const url of allowed) listeners.get(PlatformChannels.OpenExternal)({ sender }, url);
  await Promise.resolve();
  assert.deepEqual(opened, allowed);
});
