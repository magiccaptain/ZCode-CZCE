import assert from "node:assert/strict";
import test from "node:test";
import { productCapabilitiesSchema, APP_UPDATES_UNAVAILABLE } from "@zcode/shared";
import {
  DESKTOP_PRODUCT_CAPABILITIES,
  assertAppUpdatesAvailable,
} from "../src/main/productCapabilities.js";

test("fixed Desktop rules retain core capabilities and reject incomplete contracts", () => {
  const capabilities = DESKTOP_PRODUCT_CAPABILITIES;
  assert(Object.isFrozen(capabilities));
  assert.deepEqual(productCapabilitiesSchema.parse(capabilities), capabilities);
  for (const name of ["localAgent", "localProviderConfig", "skills", "mcp"] as const) {
    assert.equal(capabilities[name], true);
  }
  for (const name of [
    "webProduct",
    "appUpdates",
    "pluginMarketplace",
    "productAccount",
    "productSubscription",
    "sharing",
    "telemetry",
    "remoteWorkspaces",
    "mobileRemoteControl",
  ] as const) {
    assert.equal(capabilities[name], false);
  }
  assert.throws(() => productCapabilitiesSchema.parse({ ...capabilities, unknown: true }));
  assert.throws(() => productCapabilitiesSchema.parse({ appUpdates: false }));
  assert.throws(() => productCapabilitiesSchema.parse({ ...capabilities, appUpdates: "false" }));
  assert.equal(Reflect.set(capabilities, "appUpdates", true), false);
});

test("update execution rejects requests before side effects", () => {
  assert.throws(assertAppUpdatesAvailable, new RegExp(APP_UPDATES_UNAVAILABLE));
});
