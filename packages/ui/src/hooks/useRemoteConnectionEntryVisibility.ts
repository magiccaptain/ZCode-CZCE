import { useOptionalPlatform } from "@/hooks/usePlatform.js";

export function useRemoteConnectionEntryVisibility(): boolean {
  // 产品关闭优先于旧入口和发布身份，不能让历史配置重新开启远程管理。
  return useOptionalPlatform()?.productCapabilities?.remoteWorkspaces !== false;
}
