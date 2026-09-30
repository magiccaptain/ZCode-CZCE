import assert from "node:assert/strict";
import test from "node:test";
import {
  isDraftSuggestedPromptAllowedByProduct,
  DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS,
  DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS_OFFPEAK,
  type DraftSuggestedPromptItem,
} from "../src/v4/draftSuggestedPromptItems.js";

test("Off-Peak subscription action cannot be shown or admitted, while ordinary automation/prompt actions survive", () => {
  const item: DraftSuggestedPromptItem = {
    id: "fixture",
    label: { en: "fixture" },
    prompt: { en: "fixture" },
  };
  for (const capabilities of [{ productAccount: false }, { productSubscription: false }]) {
    assert.equal(
      isDraftSuggestedPromptAllowedByProduct(
        { ...item, actions: [DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS_OFFPEAK] },
        capabilities,
      ),
      false,
    );
    assert.equal(
      isDraftSuggestedPromptAllowedByProduct(
        { ...item, actions: [DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS] },
        capabilities,
      ),
      true,
    );
    assert.equal(isDraftSuggestedPromptAllowedByProduct(item, capabilities), true);
  }
  assert.equal(
    isDraftSuggestedPromptAllowedByProduct({
      ...item,
      actions: [DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS_OFFPEAK],
    }),
    true,
  );
});
