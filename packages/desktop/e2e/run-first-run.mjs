import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TID_V4_COMPOSER_INPUT } from "@zcode/shared";
import { createFirstRunEnvironment } from "../../../scripts/dev-desktop-first-run.mjs";
import {
  buildBaseline,
  closeBaseline,
  desktopRoot,
  launchBaseline,
  repositoryRoot,
} from "./runtime.mjs";
import {
  checkWorkDirections,
  checkWorkDirectionLayout,
  selectWorkDirection,
  skipWorkDirection,
} from "./first-run-work-directions.mjs";
import {
  checkPreferences,
  checkNoMigrationDialog,
  finishOnboarding,
} from "./first-run-preferences.mjs";

const artifacts = join(desktopRoot, ".e2e-artifacts", `first-run-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const oldRoot = await mkdtemp(join(tmpdir(), "czce-first-run-existing-"));
await mkdir(join(oldRoot, ".zcode/v2"), { recursive: true });
const oldRecordFile = join(oldRoot, ".zcode/v2/onboarding-record.json");
const oldRecord = JSON.stringify({
  version: 2,
  deviceMid: "first-run-fixture-device",
  entries: [],
  decisions: [
    {
      userId: null,
      status: "dismissed",
      reason: "user_closed",
      decidedAt: new Date().toISOString(),
    },
  ],
});
await writeFile(oldRecordFile, oldRecord);
const { version } = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const report = { passed: false, platform: `${process.platform}-${process.arch}`, cases: [] };
let app;

async function launch(firstRun) {
  const launched = await launchBaseline({
    runRoot: firstRun.runRoot,
    key: "first-run-fixture-no-credential",
    log: [],
    version,
    envPatch: firstRun.env,
  });
  app = launched.app;
  const paths = await app.evaluate(({ app: electronApp }) => ({
    home: electronApp.getPath("home"),
    userData: electronApp.getPath("userData"),
    sessionData: electronApp.getPath("sessionData"),
  }));
  assert.equal(paths.home, firstRun.runRoot);
  assert.equal(paths.userData, firstRun.env.ZCODE_DESKTOP_USER_DATA_DIR);
  assert.equal(paths.sessionData, firstRun.env.ZCODE_DESKTOP_SESSION_DATA_DIR);
  // DOM 已就绪不代表启动动画遮罩已移除；等待真实展示状态，避免截图只留下启动 Logo。
  await launched.page.locator("body.zcode-startup-ready").waitFor();
  await launched.page.locator("#loading").waitFor({ state: "detached" });
  return launched.page;
}

async function showModeStep(page, expectedMode = "office", advance = true) {
  const onboarding = page.getByTestId("onboarding-page");
  if (advance) await onboarding.getByRole("button", { name: /^(下一步|Next)$/ }).click();
  const options = onboarding.locator("button[aria-pressed]");
  await options.first().waitFor();
  assert.equal(await options.count(), 2);
  assert.match(await options.nth(0).innerText(), /办公模式|Office mode/);
  assert.match(await options.nth(1).innerText(), /编程模式|Coding mode/);
  assert.equal(
    await options.nth(0).getAttribute("aria-pressed"),
    String(expectedMode === "office"),
  );
  assert.equal(
    await options.nth(1).getAttribute("aria-pressed"),
    String(expectedMode === "coding"),
  );
  const officeBox = await options.nth(0).boundingBox();
  const codingBox = await options.nth(1).boundingBox();
  assert.ok(officeBox && codingBox && officeBox.y < codingBox.y);
  return options;
}

async function prepareLocale(firstRun, locale) {
  await mkdir(join(firstRun.runRoot, ".zcode/v2"), { recursive: true });
  await writeFile(
    join(firstRun.runRoot, ".zcode/v2/setting.json"),
    JSON.stringify({ locale, localePreference: locale }),
  );
}

async function setTheme(page, theme) {
  await page.evaluate((value) => localStorage.setItem("zcode-theme", value), theme);
  await page.reload();
  await page.waitForFunction(
    (value) => document.documentElement.classList.contains(`theme-${value}`),
    theme,
  );
  await page.getByTestId("onboarding-page").waitFor();
  await page.locator("body.zcode-startup-ready").waitFor();
  await page.locator("#loading").waitFor({ state: "detached" });
}

try {
  await buildBaseline("test");
  const inherited = {
    ...process.env,
    ZCODE_DATA_BASE_DIR: oldRoot,
    ZCODE_DESKTOP_HOME_DIR: oldRoot,
    ZCODE_DESKTOP_USER_DATA_DIR: join(oldRoot, "electron"),
    ZCODE_DESKTOP_SESSION_DATA_DIR: join(oldRoot, "electron-session"),
    ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA: "1",
    ZCODE_HOME: join(oldRoot, ".zcode"),
    ZCODE_STORAGE_DIR: join(oldRoot, "agent-storage"),
    ZCODE_SESSION_DB_PATH: join(oldRoot, "agent-storage/session.sqlite"),
  };
  const first = await createFirstRunEnvironment(inherited);
  await prepareLocale(first, "zh-CN");
  let page = await launch(first);
  await page.getByTestId("onboarding-page").waitFor();
  await setTheme(page, "zai-light");
  await checkWorkDirections(page, "zh-CN");
  await checkWorkDirectionLayout(page, 2);
  await page.screenshot({ path: join(artifacts, "first-open.png") });
  const windowBounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(520, 900));
  await page.waitForFunction(() => window.innerWidth < 640);
  await checkWorkDirectionLayout(page, 1);
  await page.screenshot({ path: join(artifacts, "work-directions-narrow.png") });
  await app.evaluate(
    ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds),
    windowBounds,
  );
  await page.waitForFunction(() => window.innerWidth >= 640);
  await selectWorkDirection(page, 0);
  await showModeStep(page);
  await page
    .getByTestId("onboarding-page")
    .getByRole("button", { name: /^(返回|Back)$/ })
    .click();
  await checkWorkDirections(page, "zh-CN", 0);
  await selectWorkDirection(page, 1);
  await showModeStep(page);
  await page.screenshot({ path: join(artifacts, "office-first-default.png") });
  await finishOnboarding(page, "office", join(artifacts, "office-preferences.png"));
  assert.equal(await page.evaluate(() => localStorage.getItem("zcode-interface-mode")), "office");
  await closeBaseline(app);
  app = undefined;
  const records = JSON.parse(
    await readFile(join(first.runRoot, ".zcode/v2/onboarding-record.json"), "utf8"),
  );
  assert.ok(records.entries.length > 0);
  assert.equal(records.entries[0].occupation, "research");
  assert.equal(records.entries[0].interfaceMode, "office");
  assert.equal(records.entries[0].memoryEnabled, false);
  assert.equal(records.entries[0].proactiveSuggestionsEnabled, false);
  const settings = JSON.parse(
    await readFile(join(first.runRoot, ".zcode/v2/setting.json"), "utf8"),
  );
  assert.equal(settings.onboardingOccupation, "research");
  assert.equal(settings.memoryEnabled, false);
  assert.equal(settings.proactiveSuggestionsEnabled, false);
  report.cases.push(
    "Chinese light theme: 12 ordered directions, unselected initially, wide/narrow layout, back/change selection; office has only suggestions and memory, both initially enabled, edits persist; completion has no migration dialog",
  );

  page = await launch(first);
  await page.getByTestId(TID_V4_COMPOSER_INPUT).waitFor();
  assert.equal(await page.getByTestId("onboarding-page").isVisible(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("zcode-interface-mode")), "office");
  await page.screenshot({ path: join(artifacts, "same-data-restart.png") });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+o" : "Control+Shift+o");
  await checkWorkDirections(page, "zh-CN", 1);
  await page.screenshot({ path: join(artifacts, "saved-research-onboarding.png") });
  await showModeStep(page);
  await page
    .getByTestId("onboarding-page")
    .getByRole("button", { name: /^(下一步|Next)$/ })
    .click();
  await checkPreferences(page, "office", false, false);
  await page
    .getByTestId("onboarding-page")
    .getByRole("button", { name: /^(跳过|Skip)$/ })
    .click();
  await checkNoMigrationDialog(page);
  await closeBaseline(app);
  app = undefined;
  const skippedPreferencesRecord = JSON.parse(
    await readFile(join(first.runRoot, ".zcode/v2/onboarding-record.json"), "utf8"),
  );
  const skippedPreferencesSettings = JSON.parse(
    await readFile(join(first.runRoot, ".zcode/v2/setting.json"), "utf8"),
  );
  assert.equal(skippedPreferencesRecord.entries[0].memoryEnabled, null);
  assert.equal(skippedPreferencesRecord.entries[0].proactiveSuggestionsEnabled, null);
  assert.equal(skippedPreferencesSettings.memoryEnabled, false);
  assert.equal(skippedPreferencesSettings.proactiveSuggestionsEnabled, false);
  report.cases.push(
    "same data restart skips onboarding; manual reopening restores research and disabled office preferences; skipping preferences completes without migration",
  );

  const second = await createFirstRunEnvironment(inherited);
  assert.notEqual(second.runRoot, first.runRoot);
  await prepareLocale(second, "en-US");
  page = await launch(second);
  await page.getByTestId("onboarding-page").waitFor();
  await setTheme(page, "zai-dark");
  await checkWorkDirections(page, "en-US");
  await checkWorkDirectionLayout(page, 2);
  await page.screenshot({ path: join(artifacts, "next-first-open.png") });
  await skipWorkDirection(page);
  const options = await showModeStep(page, "office", false);
  await options.nth(1).click();
  assert.equal(await options.nth(1).getAttribute("aria-pressed"), "true");
  assert.equal(await options.nth(0).getAttribute("aria-pressed"), "false");
  await finishOnboarding(page, "coding", join(artifacts, "coding-preferences.png"));
  assert.equal(await page.evaluate(() => localStorage.getItem("zcode-interface-mode")), "coding");
  await closeBaseline(app);
  app = undefined;
  const skipped = JSON.parse(
    await readFile(join(second.runRoot, ".zcode/v2/onboarding-record.json"), "utf8"),
  );
  assert.equal(skipped.entries[0].occupation, null);
  assert.equal(skipped.entries[0].memoryEnabled, false);
  assert.equal(skipped.entries[0].proactiveSuggestionsEnabled, false);
  const skippedSettings = JSON.parse(
    await readFile(join(second.runRoot, ".zcode/v2/setting.json"), "utf8"),
  );
  assert.equal(skippedSettings.onboardingOccupation, "other");
  assert.equal(skippedSettings.memoryEnabled, false);
  assert.equal(skippedSettings.proactiveSuggestionsEnabled, false);
  assert.equal(await readFile(oldRecordFile, "utf8"), oldRecord);
  report.cases.push(
    "English dark theme: new invocation has no direction selection; Skip keeps null/other semantics; coding has only memory, initially disabled; completion has no migration dialog, mode persists, old record untouched",
  );

  page = await launch(second);
  await page.getByTestId(TID_V4_COMPOSER_INPUT).waitFor();
  assert.equal(await page.getByTestId("onboarding-page").isVisible(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("zcode-interface-mode")), "coding");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+o" : "Control+Shift+o");
  await page.getByTestId("onboarding-page").waitFor();
  await checkWorkDirections(page, "en-US");
  await skipWorkDirection(page);
  await showModeStep(page, "coding", false);
  await page.screenshot({ path: join(artifacts, "saved-coding-onboarding.png") });
  await page
    .getByTestId("onboarding-page")
    .getByRole("button", { name: /^(下一步|Next)$/ })
    .click();
  await checkPreferences(page, "coding");
  await page.keyboard.press("Escape");
  await page.getByTestId(TID_V4_COMPOSER_INPUT).waitFor();
  await closeBaseline(app);
  app = undefined;
  report.cases.push(
    "explicit coding choice survives restart and remains selected when onboarding is reopened",
  );
  report.dataDirectories = [first.runRoot, second.runRoot];
  report.passed = true;
} finally {
  if (app) await app.close();
  await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ artifacts, ...report }, null, 2));
