import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PRODUCT_BRANDING, TID_LOGIN_TRIGGER, TID_V4_COMPOSER_INPUT } from "@zcode/shared";
import {
  runCommand,
  launchBaseline,
  closeBaseline,
  waitFor,
  desktopRoot,
  repositoryRoot,
} from "./runtime.mjs";

// 只核验真实 Main / Renderer 的品牌展示；不请求模型，不使用用户数据。
const root = await mkdtemp(join(tmpdir(), "czce-branding-"));
const artifacts = join(desktopRoot, ".e2e-artifacts", `branding-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const { version } = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const report = { passed: false, platform: `${process.platform}-${process.arch}`, cases: [] };
let app;

async function assertTransparentIcon(icon) {
  await icon.waitFor();
  const pixels = await icon.evaluate(async (node) => {
    await node.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    context.drawImage(node, 0, 0, 256, 256);
    return {
      width: node.naturalWidth,
      leftAlpha: context.getImageData(5, 128, 1, 1).data[3],
      topAlpha: context.getImageData(128, 5, 1, 1).data[3],
      markAlpha: context.getImageData(128, 90, 1, 1).data[3],
    };
  });
  assert.equal(pixels.width, 256);
  assert.equal(pixels.leftAlpha, 0);
  assert.equal(pixels.topAlpha, 0);
  assert.equal(pixels.markAlpha, 255);
}

try {
  await runCommand("pnpm", ["--filter", "@zcode/desktop", "build:no-runtime-assets"], {
    env: { ...process.env, VITE_ZCODE_E2E_STORE_BRIDGE: "1", ZCODE_ENV: "production" },
  });
  // 启动壳停留时间由真实就绪信号决定；隔离构建 HTML 的展示层，不改变生产启动时序。
  const rendererRoot = join(desktopRoot, "out/renderer");
  const startupFixture = join(root, "startup.html");
  const startupHtml = (await readFile(join(rendererRoot, "index.html"), "utf8"))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace("<head>", `<head><base href="${pathToFileURL(`${rendererRoot}/`).href}">`);
  await writeFile(startupFixture, startupHtml);
  for (const locale of ["zh-CN", "en-US"]) {
    const runRoot = join(root, locale);
    await mkdir(join(runRoot, ".zcode/v2"), { recursive: true });
    await writeFile(
      join(runRoot, ".zcode/v2/setting.json"),
      JSON.stringify({
        locale,
        localePreference: locale,
      }),
    );
    const productName = locale === "zh-CN" ? PRODUCT_BRANDING.name : PRODUCT_BRANDING.englishName;
    const { app: launched, page } = await launchBaseline({
      runRoot,
      key: "branding-fixture-no-credential",
      log: [],
      version,
      envPatch: { ZCODE_DESKTOP_APPLICATION_NAME: "" },
    });
    app = launched;
    const theme = locale === "zh-CN" ? "zai-light" : "zai-dark";
    // 主题由 Renderer localStorage 持久化，setting.json 不拥有该字段；重载走真实初始化读取。
    await page.evaluate((value) => localStorage.setItem("zcode-theme", value), theme);
    await page.reload();
    await page.waitForFunction(
      (value) => document.documentElement.classList.contains(`theme-${value}`),
      theme,
    );
    const startupPromise = app.waitForEvent("window");
    const startupId = await app.evaluate(async ({ BrowserWindow }, file) => {
      const window = new BrowserWindow({
        width: 600,
        height: 440,
        useContentSize: true,
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true },
      });
      await window.loadFile(file);
      return window.id;
    }, startupFixture);
    const startup = await startupPromise;
    // 隔离图标截图使用既有减少动态效果规则，避免缓存命中时截到 pop 动画的透明首帧。
    await startup.emulateMedia({ reducedMotion: "reduce" });
    await startup.waitForFunction(() => {
      const image = document.querySelector('#loading img[data-product-icon="czce-agent"]');
      const shell = document.querySelector(".startup-logo-shell");
      return (
        image?.complete &&
        image.naturalWidth === 256 &&
        shell &&
        getComputedStyle(shell).opacity === "1" &&
        shell?.getAnimations().every((animation) => animation.playState === "finished")
      );
    });
    await assertTransparentIcon(startup.locator('#loading img[data-product-icon="czce-agent"]'));
    assert.equal(
      await startup
        .locator(".startup-logo-shell")
        .evaluate((node) => getComputedStyle(node).boxShadow),
      "none",
    );
    await startup.screenshot({ path: join(artifacts, `${locale}-startup.png`) });
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), startupId);
    const identity = await app.evaluate(({ app: electronApp }) => ({
      name: electronApp.name,
      userData: electronApp.getPath("userData"),
      sessionData: electronApp.getPath("sessionData"),
    }));
    assert.equal(identity.name, `${PRODUCT_BRANDING.name} Dev`);
    assert.equal(identity.userData, join(runRoot, "electron"));
    assert.equal(identity.sessionData, join(runRoot, "electron-session"));
    assert.equal(await page.title(), `${PRODUCT_BRANDING.name} · ${PRODUCT_BRANDING.englishName}`);
    const onboarding = page.getByTestId("onboarding-page");
    await onboarding.waitFor();
    const brandIcon = onboarding.locator('img[data-product-icon="czce-agent"]');
    await assertTransparentIcon(brandIcon);
    assert.equal(await onboarding.locator(".onboarding-logo-sweep").count(), 0);
    const copy = await onboarding.innerText();
    assert(copy.includes(productName), copy);
    if (locale === "zh-CN") {
      assert(copy.includes(PRODUCT_BRANDING.description), copy);
      assert(copy.includes(PRODUCT_BRANDING.introduction), copy);
    }
    await page.screenshot({ path: join(artifacts, `${locale}-welcome.png`) });
    await waitFor(async () => {
      if (await onboarding.isVisible()) {
        const before = await onboarding.innerText();
        await onboarding
          .getByRole("button", { name: locale === "zh-CN" ? "跳过" : "Skip", exact: true })
          .click();
        await page.waitForFunction((previous) => {
          const node = document.querySelector('[data-testid="onboarding-page"]');
          return !node || node.innerText !== previous;
        }, before);
        return false;
      }
      return await page.getByTestId(TID_V4_COMPOSER_INPUT).isVisible();
    }, "complete localized onboarding");
    assert((await page.getByTestId(TID_LOGIN_TRIGGER).innerText()).includes(productName));
    const shellIcon = page.locator('img[data-product-icon="czce-agent"]').first();
    await assertTransparentIcon(shellIcon);
    const watermark = page.locator(
      '[data-v4-draft-logo="product"] img[data-product-icon="czce-agent"]',
    );
    await assertTransparentIcon(watermark);
    const appearance = await watermark.evaluate((node) => {
      const style = getComputedStyle(node);
      return { opacity: style.opacity, filter: style.filter, mask: style.maskImage };
    });
    assert.equal(appearance.opacity, "0.2");
    assert.equal(appearance.filter, "brightness(0.75)");
    assert.equal(appearance.mask, "none");
    await page.screenshot({ path: join(artifacts, `${locale}-workspace.png`) });
    const aboutPromise = app.waitForEvent("window");
    await app.evaluate(async ({ Menu }) => {
      const findAbout = (items) => {
        for (const item of items) {
          if (item.label === "关于 郑商智助" || item.label === "About CZCE Agent") return item;
          const nested = item.submenu && findAbout(item.submenu.items);
          if (nested) return nested;
        }
      };
      const item = findAbout(Menu.getApplicationMenu().items);
      if (!item) throw new Error("About menu item missing");
      await item.click();
    });
    const about = await aboutPromise;
    await about.getByRole("heading", { name: new RegExp(productName) }).waitFor();
    const aboutIcon = about.locator('img[data-product-icon="czce-agent"]');
    await assertTransparentIcon(aboutIcon);
    await about.emulateMedia({ colorScheme: locale === "zh-CN" ? "light" : "dark" });
    assert((await about.locator("body").innerText()).includes("ZCode"));
    await about.screenshot({ path: join(artifacts, `${locale}-about.png`) });
    await about
      .getByRole("button", { name: locale === "zh-CN" ? "确定" : "OK", exact: true })
      .click();
    await closeBaseline(app);
    app = undefined;
    report.cases.push(
      `${locale} / ${theme}: transparent startup, onboarding and workspace icons, dimmed complete Logo watermark, transparent About PNG, runtime identity, explicit directories and upstream copyright`,
    );
  }
  report.passed = true;
} finally {
  if (app) await app.close();
  await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`Branding E2E: ${JSON.stringify(report)}\nArtifacts: ${artifacts}\n`);
}
