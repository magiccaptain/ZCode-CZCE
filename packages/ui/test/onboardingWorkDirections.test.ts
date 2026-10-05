import assert from "node:assert/strict";
import test from "node:test";
import * as shared from "@zcode/shared";
import { occupations } from "../src/onboarding/occupationOptions.js";
import zhCN from "../src/i18n/locales/zh-CN.js";
import enUS from "../src/i18n/locales/en-US.js";

const directions = [
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
];
const legacyValues = [
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
];

test("onboarding presents the twelve CZCE work directions in the agreed order", () => {
  assert.deepEqual(occupations, directions);
});

test("new directions survive full settings and settings patch validation unchanged", () => {
  for (const value of directions) {
    assert.equal(shared.appSettingsOccupationEnum.parse(value), value);
    assert.equal(
      shared.appSettingsSchema.parse({ onboardingOccupation: value }).onboardingOccupation,
      value,
    );
    assert.equal(
      shared.appSettingsPatchSchema.parse({ onboardingOccupation: value }).onboardingOccupation,
      value,
    );
  }
});

test("legacy settings remain readable and writable without being renamed to departments", () => {
  for (const value of legacyValues) {
    assert.equal(
      shared.appSettingsSchema.parse({ onboardingOccupation: value }).onboardingOccupation,
      value,
    );
    assert.equal(
      shared.appSettingsPatchSchema.parse({ onboardingOccupation: value }).onboardingOccupation,
      value,
    );
  }
});

test("unknown directions are rejected while a skipped direction remains nullable", () => {
  for (const value of ["unknown_department", "", "ADMINISTRATION", 1, false, {}]) {
    assert.equal(
      shared.appSettingsSchema.safeParse({ onboardingOccupation: value }).success,
      false,
    );
    assert.equal(
      shared.appSettingsPatchSchema.safeParse({ onboardingOccupation: value }).success,
      false,
    );
  }
  assert.equal(
    shared.appSettingsPatchSchema.parse({ onboardingOccupation: null }).onboardingOccupation,
    null,
  );
});

test("prefill accepts displayed directions and leaves legacy, absent or unknown values unselected", () => {
  assert.equal(typeof shared.isOnboardingWorkDirection, "function");
  for (const value of directions) assert.equal(shared.isOnboardingWorkDirection(value), true);
  for (const value of [...legacyValues, null, undefined, "unknown", "", {}]) {
    assert.equal(shared.isOnboardingWorkDirection(value), false);
  }
});

test("Chinese and English supply every direction title and task description", () => {
  for (const locale of [zhCN, enUS]) {
    for (const value of directions) {
      assert.ok(locale[`occupationOnboarding.${value}`]?.trim(), `${value} title missing`);
      assert.ok(
        locale[`occupationOnboarding.${value}Description`]?.trim(),
        `${value} description missing`,
      );
    }
    for (const value of legacyValues)
      assert.equal(locale[`occupationOnboarding.${value}`], undefined);
  }
  assert.equal(zhCN["occupationOnboarding.administration"], "综合办公与行政");
  assert.equal(zhCN["occupationOnboarding.other"], "其他工作");
});
