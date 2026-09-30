import {
  TID_LOGIN_USE_API_KEY_BUTTON,
  TID_LOGIN_API_KEY_SKIP_BUTTON,
  TID_V4_COMPOSER_INPUT,
} from "@zcode/shared";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron } from "playwright-core";
import {
  resolveSpawnRuntimeOptions,
  quoteArgsForWindowsShell,
} from "../../../scripts/spawn-command.mjs";

export const desktopRoot = resolve(import.meta.dirname, "..");
export const repositoryRoot = resolve(desktopRoot, "../..");

export function redact(value, key) {
  return String(value)
    .replaceAll(key, "[REDACTED]")
    .replace(/\bsk-[\w-]+/g, "[REDACTED]")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/g, "[URL]");
}

export async function runCommand(command, args, { cwd = repositoryRoot, env = process.env } = {}) {
  await new Promise((resolveRun, reject) => {
    const runtimeOptions = resolveSpawnRuntimeOptions(command);
    const child = spawn(command, runtimeOptions.shell ? quoteArgsForWindowsShell(args) : args, {
      cwd,
      env,
      stdio: "inherit",
      ...runtimeOptions,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}

export async function waitFor(check, description, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}

export async function buildBaseline(environment = "test") {
  const env = { ...process.env, VITE_ZCODE_E2E_STORE_BRIDGE: "1", ZCODE_ENV: environment };
  await runCommand(process.execPath, ["scripts/build-desktop-agent-cli.mjs"], { env });
  await runCommand(process.execPath, ["scripts/ensure-local-runtime-assets.mjs"], {
    cwd: desktopRoot,
    env,
  });
  await runCommand(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--filter", "@zcode/desktop", "build:no-runtime-assets"],
    { env },
  );
  const paths = [
    "out/main/index.js",
    "out/host/index.js",
    "out/preload/index.cjs",
    "out/renderer/index.html",
    `bundled-agents/${process.platform}-${process.arch}/glm/zcode.cjs`,
  ];
  const hashes = {};
  for (const relativePath of paths) {
    hashes[relativePath] = createHash("sha256")
      .update(await readFile(join(desktopRoot, relativePath)))
      .digest("hex");
  }
  await mkdir(join(desktopRoot, ".e2e-cache"), { recursive: true });
  await writeFile(
    join(desktopRoot, ".e2e-cache/baseline-build.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        node: process.version,
        environment,
        hashes,
      },
      null,
      2,
    ),
  );
}

export async function launchBaseline({
  runRoot,
  key,
  log,
  version,
  main,
  envPatch = {},
  executablePath,
  extraArgs = [],
}) {
  const appRoot = join(runRoot, "app");
  await mkdir(appRoot, { recursive: true });
  await writeFile(
    join(appRoot, "package.json"),
    JSON.stringify({
      name: "zcode-baseline",
      version,
      type: "module",
      main: main ?? join(desktopRoot, "out/main/index.js"),
    }),
  );
  const env = {
    ...process.env,
    ZCODE_DATA_BASE_DIR: runRoot,
    ZCODE_HOME: join(runRoot, ".zcode"),
    ZCODE_STORAGE_DIR: join(runRoot, "agent-storage"),
    ZCODE_SESSION_DB_PATH: join(runRoot, "agent-storage/session.sqlite"),
    ZCODE_DESKTOP_HOME_DIR: runRoot,
    ZCODE_DESKTOP_USER_DATA_DIR: join(runRoot, "electron"),
    ZCODE_DESKTOP_SESSION_DATA_DIR: join(runRoot, "electron-session"),
    ZCODE_DESKTOP_APPLICATION_NAME: `ZCode Baseline ${runRoot.split(/[\\/]/).at(-1)}`,
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(repositoryRoot, "config/provider/zcode-builtin.json"),
    ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
    VITE_ZCODE_E2E_STORE_BRIDGE: "1",
    ...envPatch,
  };
  // 不设置 ZCODE_E2E_RUN_ID：该旧 WDIO 退出适配会在清理后 SIGKILL Main，
  // 本场景要求观察正常退出码，再验证同一数据目录的恢复。
  delete env.ZCODE_E2E_RUN_ID;
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  if (executablePath) delete env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE;
  const app = await _electron.launch({
    args: executablePath ? extraArgs : [...extraArgs, appRoot],
    executablePath,
    cwd: desktopRoot,
    env,
    timeout: 60_000,
  });
  for (const stream of [app.process().stdout, app.process().stderr]) {
    stream.on("data", (chunk) => log.push(redact(chunk, key)));
  }
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => log.push(redact(`renderer: ${error.message}`, key)));
    return { app, page };
  } catch (error) {
    await app.close();
    throw error;
  }
}

export async function closeBaseline(app) {
  const child = app.process();
  const exited = new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode });
    } else {
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    }
  });
  await app.close();
  const result = await exited;
  assert.equal(result.code, 0, `Electron did not exit normally: ${JSON.stringify(result)}`);
  return result;
}

export async function prepareBaselineLocale(runRoot) {
  // 系统语言会改变首次引导按钮，固定测试目录语言以匹配基线的英文交互契约。
  await mkdir(join(runRoot, ".zcode/v2"), { recursive: true });
  await writeFile(
    join(runRoot, ".zcode/v2/setting.json"),
    JSON.stringify({ locale: "en-US", localePreference: "en-US" }),
  );
}

export async function enterBaselineUI(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="onboarding-page"]') ||
      document.querySelector('[data-testid="login-use-api-key-button"]') ||
      document.querySelector('[data-testid="v4-composer-input"]'),
    null,
    { timeout: 60_000 },
  );
  // 首次启动的登录/引导来自异步加载，必须按当前可见页面推进；
  // 不能一次 isVisible 就假定后续不会出现 onboarding。
  await waitFor(async () => {
    if (await page.getByTestId("onboarding-page").isVisible()) {
      const before = await page.getByTestId("onboarding-page").innerText();
      await page.getByRole("button", { name: "Skip", exact: true }).click();
      await page.waitForFunction((previous) => {
        const onboarding = document.querySelector('[data-testid="onboarding-page"]');
        return !onboarding || onboarding.innerText !== previous;
      }, before);
      return false;
    }
    if (await page.getByTestId(TID_LOGIN_USE_API_KEY_BUTTON).isVisible()) {
      await page.getByTestId(TID_LOGIN_USE_API_KEY_BUTTON).click();
      await page.getByTestId(TID_LOGIN_API_KEY_SKIP_BUTTON).click();
      return false;
    }
    return await page.getByTestId(TID_V4_COMPOSER_INPUT).isVisible();
  }, "first-run UI completed");
}
