/**
 * useTokenRefresh —— Token 刷新 hook（常驻层）
 *
 * 挂载在 Root 或 App 组件中，确保 401 刷新在任何时候都能工作。
 * 监听全局的 401 事件，调用 oauthService.refreshToken 刷新 token。
 */
import { useOptionalPlatform } from "./usePlatform.js";
import { useCallback } from "react";
import { logger } from "../logger.js";
import { useServices } from "./useServices.js";

export function useTokenRefresh() {
  const { oauthService } = useServices();
  const accountEnabled = useOptionalPlatform()?.productCapabilities?.productAccount !== false;

  /** 尝试刷新 token，失败则返回 false */
  const tryRefresh = useCallback(async (): Promise<boolean> => {
    if (!accountEnabled) return false;
    try {
      await oauthService.refreshToken();
      logger.info("[useTokenRefresh] token 刷新成功");
      return true;
    } catch (err) {
      logger.error("[useTokenRefresh] token 刷新失败:", err);
      return false;
    }
  }, [accountEnabled, oauthService]);

  /** 清除所有 provider 凭据 */
  const clearCredentials = useCallback(async () => {
    if (accountEnabled) await oauthService.logoutAll();
  }, [accountEnabled, oauthService]);

  return { tryRefresh, clearCredentials };
}
