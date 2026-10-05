import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDesktopProductIdentity,
  resolveDesktopRuntimeIdentity,
} from "../scripts/desktop-product-identity.mjs";

test("display names change while existing installation and data identities remain", () => {
  const production = resolveDesktopProductIdentity({ ZCODE_ENV: "production" });
  const preview = resolveDesktopProductIdentity({ ZCODE_ENV: "test" });
  assert.equal(production.productName, "郑商智助");
  assert.equal(preview.productName, "郑商智助 Preview");
  assert.equal(production.appId, "dev.zcode.app");
  assert.equal(preview.appId, "dev.zcode.app.preview");
  assert.equal(production.linuxExecutableName, "zcode");
  assert.equal(preview.linuxExecutableName, "zcode-preview");

  for (const [options, applicationName, dataDirectoryName] of [
    [{ isPackaged: true, flavor: "production" }, "郑商智助", "ZCode"],
    [{ isPackaged: true, flavor: "preview" }, "郑商智助 Preview", "ZCode Preview"],
    [{ isPackaged: false, flavor: "production" }, "郑商智助 Dev", "ZCode Dev"],
    [{ isPackaged: false, flavor: "preview" }, "郑商智助 Dev", "ZCode Dev"],
  ]) {
    assert.deepEqual(resolveDesktopRuntimeIdentity(options), {
      applicationName,
      dataDirectoryName,
    });
  }
});

test("explicit application-name isolation still controls display and default data directory", () => {
  for (const isPackaged of [true, false]) {
    assert.deepEqual(
      resolveDesktopRuntimeIdentity({
        isPackaged,
        flavor: "preview",
        applicationName: "  isolated-branding-fixture  ",
      }),
      {
        applicationName: "isolated-branding-fixture",
        dataDirectoryName: "isolated-branding-fixture",
      },
    );
    assert.equal(
      resolveDesktopRuntimeIdentity({ isPackaged, applicationName: "  " }).dataDirectoryName,
      isPackaged ? "ZCode" : "ZCode Dev",
    );
  }
});
