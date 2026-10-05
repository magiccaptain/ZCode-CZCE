import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function createFirstRunEnvironment(inheritedEnv = process.env) {
  const runRoot = await mkdtemp(join(tmpdir(), "czce-first-run-"));
  return {
    runRoot,
    env: {
      ...inheritedEnv,
      // 引导记录、全局设置、Electron 偏好与 Agent 会话各有路径；
      // 只清引导标记仍会因已有任务跳过引导，因此在启动前统一隔离持久化目录。
      ZCODE_DATA_BASE_DIR: runRoot,
      ZCODE_DESKTOP_HOME_DIR: runRoot,
      ZCODE_DESKTOP_USER_DATA_DIR: join(runRoot, "electron"),
      ZCODE_DESKTOP_SESSION_DATA_DIR: join(runRoot, "electron-session"),
      ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA: "0",
      ZCODE_HOME: join(runRoot, ".zcode"),
      ZCODE_STORAGE_DIR: join(runRoot, "agent-storage"),
      ZCODE_SESSION_DB_PATH: join(runRoot, "agent-storage/session.sqlite"),
    },
  };
}

async function main() {
  const { runRoot, env } = await createFirstRunEnvironment();
  console.log(`[first-run] Data directory: ${runRoot}`);
  console.log(
    "[first-run] Data is retained after exit; the next invocation creates a new directory.",
  );
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const child = spawn(process.execPath, [join(repoRoot, "scripts/dev-desktop-env.mjs"), "test"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    console.error(`[first-run] Failed to start Desktop: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(`[first-run] ${error.message}`);
    process.exitCode = 1;
  });
}
