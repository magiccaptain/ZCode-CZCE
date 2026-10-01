import { homedir } from "node:os";
import { posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

function pathApiForPlatform(platform) {
  return platform === "win32" ? win32 : posix;
}

export function resolveProductionRemoteAssetCacheDir(
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
) {
  const pathApi = pathApiForPlatform(platform);
  if (platform === "darwin") {
    return pathApi.join(homeDir, "Library", "Application Support", "ZCode", "remote-assets-cache");
  }

  if (platform === "win32") {
    const appDataDir = env.APPDATA?.trim() || pathApi.join(homeDir, "AppData", "Roaming");
    return pathApi.join(appDataDir, "ZCode", "remote-assets-cache");
  }

  const configDir = env.XDG_CONFIG_HOME?.trim() || pathApi.join(homeDir, ".config");
  return pathApi.join(configDir, "ZCode", "remote-assets-cache");
}

export function buildDesktopRemoteProdEnv(
  baseEnv = process.env,
  platform = process.platform,
  homeDir = homedir(),
) {
  const cacheDir =
    baseEnv.ZCODE_REMOTE_ASSET_CACHE_DIR?.trim() ||
    resolveProductionRemoteAssetCacheDir(baseEnv, platform, homeDir);

  return {
    ...baseEnv,
    // remote CDN 基址现在跟随 ZCODE_ENV 分流；该脚本用于复现生产态下载链路，
    // 因此需要同时强制 production 和 CDN 开关，避免默认 test 环境落到测试资源 CDN。
    ZCODE_ENV: "production",
    ZCODE_DEV_REMOTE_ASSET_USE_CDN: "1",
    ZCODE_REMOTE_ASSET_CACHE_DIR: cacheDir,
  };
}

export function resolvePnpmCommand(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function runDesktopRemoteProdDev() {
  // 关闭执行而非仅删除根命令，防止旧脚本重新打开远端 CDN 调试链。
  throw new Error("Desktop-only: remote workspace development is unavailable");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDesktopRemoteProdDev();
}
