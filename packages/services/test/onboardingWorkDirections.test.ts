import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnboardingRecordService } from "../src/onboarding/onboardingRecordService.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";

test("record sync restores new directions, preserves legacy values and keeps skip semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "czce-work-direction-record-"));
  setDataBaseDir(root);
  const service = createOnboardingRecordService({
    loadUserId: async () => null,
    hasExistingLocalTask: async () => false,
  });
  try {
    for (const value of [
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
      "developer",
      "finance",
      "legal",
      null,
    ]) {
      await service.appendRecord("work-direction-fixture-device", {
        occupation: value,
        interfaceMode: "office",
        memoryEnabled: true,
        proactiveSuggestionsEnabled: true,
        completedAt: new Date().toISOString(),
      });
      const path = join(getAppConfigDir(), "onboarding-record.json");
      const before = await readFile(path, "utf8");
      assert.equal((await service.getLatestEntry())?.occupation, value);
      assert.deepEqual(await service.syncSettingsFromRecord(), {
        onboardingOccupation: value ?? "other",
        memoryEnabled: true,
        proactiveSuggestionsEnabled: true,
      });
      assert.equal(await readFile(path, "utf8"), before);
      assert.equal(await service.shouldOnboard("work-direction-fixture-device"), false);
    }
  } finally {
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
});
