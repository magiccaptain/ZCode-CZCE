import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PlatformChannels } from "@zcode/shared";
import { desktopRoot, waitFor } from "./runtime.mjs";

export async function prepareAccountNativeProbe() {
  const bootstrap = join(desktopRoot, ".e2e-cache/account-bootstrap.mjs");
  await writeFile(
    bootstrap,
    `
import { ipcMain, shell } from 'electron';
const listeners = new Map();
const on = ipcMain.on.bind(ipcMain);
ipcMain.on = (channel, fn) => { listeners.set(channel, fn); return on(channel, fn); };
const opened = [];
shell.openExternal = async url => { opened.push(url); };
globalThis.__accountProbe = { listeners, opened };
await import(${JSON.stringify(pathToFileURL(join(desktopRoot, "out/main/index.js")).href)});
`,
  );
  return bootstrap;
}

export async function assertAccountNativeBoundary(app, page) {
  const result = await app.evaluate(({ app, BrowserWindow }, channels) => {
    const win =
      BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes("index.html"),
      ) ?? BrowserWindow.getAllWindows()[0];
    const probe = globalThis.__accountProbe;
    const sent = [];
    const browserRouted = [];
    const send = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel, ...args) => {
      if ([channels.OAuthCallback, channels.PaymentCallback].includes(channel)) sent.push(channel);
      if (channel === channels.OpenBrowserUrl) browserRouted.push(args);
      return send(channel, ...args);
    };
    const event = { sender: win.webContents };
    probe.listeners.get(channels.OAuthRegisterState)(event, { state: "fixture-old-state" });
    for (const url of [
      "zcode://oauth/callback?state=fixture-old-state&code=fixture",
      "zcode://payment/callback?order=fixture",
    ])
      app.emit("open-url", { preventDefault() {} }, url);
    probe.listeners.get(channels.OAuthCallbackHandled)(event);
    probe.listeners.get(channels.RendererReady)(event);
    for (const url of [
      "https://bigmodel.cn/login",
      "https://chat.z.ai/api/oauth/authorize?redirect_uri=zcode%3A%2F%2Foauth%2Fcallback",
      "https://zcode.z.ai/coding-plan?embedded=app",
    ])
      probe.listeners.get(channels.OpenExternal)(event, url);
    probe.listeners.get(channels.OpenExternal)(event, {
      sourceUrl: "https://zcode.z.ai/coding-plan?embedded=app",
      url: "https://www.paypal.com/fixture",
    });
    const blockedOpened = probe.opened.splice(0);
    const allowed = [
      "https://fixture.invalid/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback",
      "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
      "https://zcode.z.ai/docs",
      "https://www.paypal.com/",
    ];
    for (const url of allowed) probe.listeners.get(channels.OpenExternal)(event, url);
    const opened = probe.opened.splice(0);
    const guestListeners = new Map();
    const guest = {
      on: (name, fn) => guestListeners.set(name, fn),
      getURL: () => "https://zcode.z.ai/coding-plan?embedded=app",
      loadURL: () => {
        throw Error("disabled guest loadURL");
      },
      setWindowOpenHandler: (fn) => {
        guest.popup = fn;
      },
    };
    // 旧 guest fixture 只隔离原生端口，实际执行已注册 did-attach 的 popup/navigation guard。
    win.webContents.emit("did-attach-webview", {}, guest);
    const popup = guest.popup({ url: "https://www.paypal.com/fixture", disposition: "new-window" });
    let navigationBlocked = false;
    guestListeners.get("will-navigate")(
      {
        preventDefault() {
          navigationBlocked = true;
        },
      },
      "https://www.paypal.com/fixture",
    );
    const callback =
      "https://zcode.z.ai/coding-plan/payment/callback?returnTo=%2Fcoding-plan%3Fembedded%3Dapp";
    guest.getURL = () => "https://provider.example/docs";
    const callbackPopup = guest.popup({ url: callback, disposition: "new-window" });
    let callbackNavigationBlocked = false;
    guestListeners.get("will-navigate")(
      {
        preventDefault() {
          callbackNavigationBlocked = true;
        },
      },
      callback,
    );
    guest.getURL = () => callback;
    const callbackSourcePopup = guest.popup({
      url: "https://www.paypal.com/fixture",
      disposition: "new-window",
    });
    let callbackSourceNavigationBlocked = false;
    guestListeners.get("will-navigate")(
      {
        preventDefault() {
          callbackSourceNavigationBlocked = true;
        },
      },
      "https://www.paypal.com/fixture",
    );
    const guestOpened = probe.opened.splice(0);
    const blockedBrowserRouted = browserRouted.splice(0);
    guest.getURL = () => "https://provider.example/docs";
    let ordinaryNavigationBlocked = false;
    guestListeners.get("will-navigate")(
      {
        preventDefault() {
          ordinaryNavigationBlocked = true;
        },
      },
      "https://www.paypal.com/",
    );
    probe.attachments = [];
    win.webContents.on("will-attach-webview", (event, _preferences, params) => {
      if (params.src?.includes("coding-plan")) probe.attachments.push(event.defaultPrevented);
    });
    return {
      sent,
      blockedOpened,
      allowed,
      opened,
      guestOpened,
      popup,
      navigationBlocked,
      callbackPopup,
      callbackNavigationBlocked,
      callbackSourcePopup,
      callbackSourceNavigationBlocked,
      blockedBrowserRouted,
      ordinaryNavigationBlocked,
    };
  }, PlatformChannels);
  assert.deepEqual(result.sent, []);
  assert.deepEqual(result.blockedOpened, []);
  assert.deepEqual(result.opened, result.allowed);
  assert.deepEqual(result.guestOpened, []);
  assert.deepEqual(result.popup, { action: "deny" });
  assert.equal(result.navigationBlocked, true);
  assert.deepEqual(result.callbackPopup, { action: "deny" });
  assert.equal(result.callbackNavigationBlocked, true);
  assert.deepEqual(result.callbackSourcePopup, { action: "deny" });
  assert.equal(result.callbackSourceNavigationBlocked, true);
  assert.deepEqual(result.blockedBrowserRouted, []);
  assert.equal(result.ordinaryNavigationBlocked, false);
  // 真实 DOM 创建 guest 请求；Main 必须在 Chromium 导航/专用 preload 之前阻止。
  await page.evaluate(() => {
    const view = document.createElement("webview");
    view.id = "account-native-fixture";
    view.src = "http://127.0.0.1:9/coding-plan?embedded=app";
    document.body.append(view);
  });
  await waitFor(
    async () => (await app.evaluate(() => globalThis.__accountProbe.attachments.length)) > 0,
    "native product webview attach boundary",
  );
  assert.deepEqual(await app.evaluate(() => globalThis.__accountProbe.attachments), [true]);
  await page.evaluate(() => document.getElementById("account-native-fixture")?.remove());
  await page.evaluate(() => {
    const view = document.createElement("webview");
    view.id = "account-callback-fixture";
    view.src =
      "https://zcode.z.ai/coding-plan/payment/callback?returnTo=%2Fcoding-plan%3Fembedded%3Dapp";
    document.body.append(view);
  });
  await waitFor(
    async () => (await app.evaluate(() => globalThis.__accountProbe.attachments.length)) === 2,
    "native payment callback webview attach boundary",
  );
  assert.deepEqual(await app.evaluate(() => globalThis.__accountProbe.attachments), [true, true]);
  await page.evaluate(() => document.getElementById("account-callback-fixture")?.remove());
}
