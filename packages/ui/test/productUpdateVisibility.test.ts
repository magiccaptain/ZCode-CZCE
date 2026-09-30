import assert from "node:assert/strict";
import test from "node:test";
import type { ProductCapabilities } from "@zcode/shared";
import { shouldShowDesktopUpdateEntry } from "../src/lib/desktopUpdateMenu.js";

const disabled: ProductCapabilities = {
  localAgent: true,
  localProviderConfig: true,
  skills: true,
  mcp: true,
  webProduct: false,
  appUpdates: false,
  pluginMarketplace: false,
  productAccount: false,
  productSubscription: false,
  sharing: false,
  telemetry: false,
  remoteWorkspaces: false,
  mobileRemoteControl: false,
};

test("explicit product rule wins over production and preview publication identity", () => {
  for (const flavor of ["production", "preview"] as const) {
    assert.equal(shouldShowDesktopUpdateEntry(flavor, disabled), false);
  }
  assert.equal(shouldShowDesktopUpdateEntry("production"), true);
  assert.equal(shouldShowDesktopUpdateEntry("preview"), false);
});
