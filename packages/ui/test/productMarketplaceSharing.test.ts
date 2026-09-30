import assert from "node:assert/strict";
import test from "node:test";
import { isDraftSuggestedPromptAllowedByProduct } from "../src/v4/draftSuggestedPromptItems.js";
import { createShareImportIntent } from "../src/root/shareImportIntent.js";
import { ensureConversationShareAttempt } from "../src/v4/conversationShareAttempt.js";
import {
  requestPluginStoreOpen,
  consumePluginStoreOpenTarget,
  addPluginStoreOpenListener,
} from "../src/lib/pluginStoreNavigation.js";

test("disabled marketplace rejects recommended plugin but preserves ordinary local prompt", () => {
  assert.equal(
    isDraftSuggestedPromptAllowedByProduct(
      { plugin: { stableId: "fixture", label: {} } },
      { pluginMarketplace: false },
    ),
    false,
  );
  assert.equal(isDraftSuggestedPromptAllowedByProduct({}, { pluginMarketplace: false }), true);
});
test("old market navigation cannot enqueue a target or subscribe an event", () => {
  let events = 0;
  const oldWindow = globalThis.window;
  Object.assign(globalThis, {
    window: {
      dispatchEvent() {
        events++;
      },
      addEventListener() {
        events++;
      },
      removeEventListener() {},
    },
  });
  try {
    requestPluginStoreOpen({ intent: "add-marketplace" }, { pluginMarketplace: false });
    assert.equal(consumePluginStoreOpenTarget({ pluginMarketplace: false }), null);
    addPluginStoreOpenListener(
      () => {
        events++;
      },
      { pluginMarketplace: false },
    )();
    assert.equal(events, 0);
  } finally {
    Object.assign(globalThis, { window: oldWindow });
  }
});
test("disabled old share import and publish attempts reject before generating request identities", () => {
  let ids = 0;
  assert.throws(
    () =>
      createShareImportIntent(
        "fixture",
        () => {
          ids++;
          return "id";
        },
        undefined,
        { sharing: false },
      ),
    /unavailable/,
  );
  assert.throws(
    () =>
      ensureConversationShareAttempt(
        { key: "old", clientRequestId: "old", disclosureAcceptedAt: 1 },
        "old",
        "session",
        {
          now: () => {
            ids++;
            return 1;
          },
        },
        { sharing: false },
      ),
    /unavailable/,
  );
  assert.equal(ids, 0);
});
