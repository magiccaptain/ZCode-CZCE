/** 首次引导按日常职责展示的工作方向；顺序也是 UI 的展示顺序。 */
export const ONBOARDING_WORK_DIRECTIONS = [
  "administration",
  "research",
  "market_service",
  "member_service",
  "trading_settlement",
  "delivery_warehousing",
  "risk_surveillance",
  "legal_audit",
  "technology_data",
  "finance_procurement",
  "party_hr",
  "other",
] as const;

export type OnboardingWorkDirection = (typeof ONBOARDING_WORK_DIRECTIONS)[number];

// 旧职业值只保留读写兼容，不能按同名或近似含义自动改成交易所岗位。
export const ONBOARDING_OCCUPATION_VALUES = [
  ...ONBOARDING_WORK_DIRECTIONS,
  "office",
  "developer",
  "independent",
  "infrastructure",
  "product",
  "design",
  "student",
  "creator",
  "operations",
  "marketing",
  "finance",
  "accounting",
  "legal",
] as const;

export type OnboardingOccupation = (typeof ONBOARDING_OCCUPATION_VALUES)[number];

/** 预填只接受当前可见方向；旧职业、未知值和跳过都保持未选择。 */
export function isOnboardingWorkDirection(value: unknown): value is OnboardingWorkDirection {
  return (
    typeof value === "string" && (ONBOARDING_WORK_DIRECTIONS as readonly string[]).includes(value)
  );
}
