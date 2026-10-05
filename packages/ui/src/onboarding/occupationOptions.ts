import {
  Code2,
  ShieldCheck,
  PanelsTopLeft,
  ClipboardList,
  ChartNoAxesCombined,
  UsersRound,
  ArrowLeftRight,
  Warehouse,
  Megaphone,
  Wallet,
  Landmark,
  Scale,
  Ellipsis,
  type LucideIcon,
} from "lucide-react";
import { ONBOARDING_WORK_DIRECTIONS, type OnboardingWorkDirection } from "@zcode/shared";

export const occupations = ONBOARDING_WORK_DIRECTIONS;

export type OccupationValue = OnboardingWorkDirection;

/** 步骤 2 模式选择用的图标：coding / office。 */
export const modeOptionIcons = {
  coding: Code2,
  office: PanelsTopLeft,
} as const;

const occupationIcons: Record<OccupationValue, LucideIcon> = {
  administration: ClipboardList,
  research: ChartNoAxesCombined,
  market_service: Megaphone,
  member_service: UsersRound,
  trading_settlement: ArrowLeftRight,
  delivery_warehousing: Warehouse,
  risk_surveillance: ShieldCheck,
  legal_audit: Scale,
  technology_data: Code2,
  finance_procurement: Wallet,
  party_hr: Landmark,
  other: Ellipsis,
};

export function getOccupationIcon(index: number): LucideIcon {
  const value = occupations[index];
  return value ? occupationIcons[value] : Ellipsis;
}
