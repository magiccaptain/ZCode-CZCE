import { useOptionalPlatform } from "./usePlatform.js";
import { useEffect } from "react";
import type { AppSettings } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { useOffPeakTaskStore } from "@/store/offPeakTaskStore.js";

/** 两个闲时入口共享初始化/连接/Registry 通知边界，不在组件中另存资格。 */
export function useOffPeakEligibility(
  settings: AppSettings | null | undefined,
  registryRevision: number | undefined,
): void {
  const capabilities = useOptionalPlatform()?.productCapabilities;
  const enabled =
    capabilities?.productAccount !== false && capabilities?.productSubscription !== false;
  const { offPeakTaskService, codingPlanSubscriptionService } = useServices();
  const initialize = useOffPeakTaskStore((state) => state.initialize);
  const refresh = useOffPeakTaskStore((state) => state.refreshCodingPlanSupport);
  const family = settings?.providerFamilyDomain;
  const connection = family ? settings?.providerFamilyConnectionSelections?.[family] : undefined;
  const freshnessKey = settings
    ? JSON.stringify([registryRevision, family, connection])
    : undefined;

  useEffect(() => {
    if (!enabled) return;
    void initialize({ offPeakTaskService, codingPlanSubscriptionService });
  }, [enabled, initialize, offPeakTaskService, codingPlanSubscriptionService]);

  useEffect(() => {
    if (!enabled || freshnessKey === undefined) return;
    // Settings 变化只是失效信号；ProviderSettings View revision 来自 Registry 已完成发布。
    // 即使选择没变，账号稍后就绪也会重查；相同 key 的双入口通知由 Store 去重。
    void refresh(offPeakTaskService, freshnessKey);
  }, [enabled, freshnessKey, offPeakTaskService, refresh]);
}
