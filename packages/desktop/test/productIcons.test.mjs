import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function assertPngSize(data, size) {
  assert(data.subarray(0, 8).equals(pngSignature));
  assert.equal(data.readUInt32BE(16), size);
  assert.equal(data.readUInt32BE(20), size);
}

test("all product raster copies match at their required desktop sizes", async () => {
  for (const size of sizes) {
    const publicIcon = await readFile(resolve(root, `public/logo/icons/${size}x${size}.png`));
    const desktopIcon = await readFile(
      resolve(root, `packages/desktop/build/icons/${size}x${size}.png`),
    );
    assertPngSize(publicIcon, size);
    assert(desktopIcon.equals(publicIcon), `${size}px product copies differ`);
  }
  const master = await readFile(resolve(root, "public/logo/icons/1024x1024.png"));
  assert((await readFile(resolve(root, "public/icon_512@2x.png"))).equals(master));
  for (const name of ["icon.png", "icon_windows.png", "icon_installer.png"]) {
    assert((await readFile(resolve(root, `packages/desktop/build/${name}`))).equals(master));
  }
  const agentIcon = await readFile(resolve(root, "public/logo/czce-agent.png"));
  assertPngSize(agentIcon, 256);
  assert(
    (
      await readFile(resolve(root, "packages/desktop/src/renderer/public/branding/czce-agent.png"))
    ).equals(agentIcon),
  );
  assert(!agentIcon.equals(await readFile(resolve(root, "public/logo/icons/256x256.png"))));
  for (const name of ["icon-glm.png", "icon-glm-for-light.png", "icon-glm-for-dark.png"]) {
    assert(
      (await readFile(resolve(root, `packages/ui/src/assets/cli-icons/${name}`))).equals(agentIcon),
    );
  }
  const vector = await readFile(resolve(root, "packages/ui/src/assets/branding/czce-agent.svg"));
  assert(
    (
      await readFile(resolve(root, "packages/desktop/src/renderer/public/branding/czce-agent.svg"))
    ).equals(vector),
  );
});

test("transparent interface and outline variants share the application mark without its backplate", async () => {
  const vector = await readFile(
    resolve(root, "packages/ui/src/assets/branding/czce-agent.svg"),
    "utf8",
  );
  const outline = await readFile(
    resolve(root, "packages/ui/src/assets/branding/czce-agent-outline.svg"),
    "utf8",
  );
  const application = await readFile(resolve(root, "public/logo/czce-agent-app.svg"), "utf8");
  const geometry = (svg) =>
    [...svg.matchAll(/<(?:rect|path)\b[^>]*>/g)]
      .filter(([tag]) => !tag.includes("data-native-backplate"))
      .map(([tag]) =>
        [...tag.matchAll(/\s(?:d|x|y|width|height|rx)="[^"]*"/g)]
          .map(([attribute]) => attribute.trim())
          .join(" "),
      );
  assert.deepEqual(geometry(outline), geometry(vector));
  assert.deepEqual(geometry(application), geometry(vector));
  assert.equal(geometry(vector).length, 5);
  assert(!vector.includes("#tile"));
  assert(!outline.includes("<defs>"));
  assert(!/fill="(?!none)[^"]*"/.test(outline));
  assert(outline.includes('stroke="currentColor"'));
  assert(application.includes('data-native-backplate="true"'));
});

test("Windows and macOS icon containers hold valid multiresolution PNG frames", async () => {
  const ico = await readFile(resolve(root, "public/logo/icons/icon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);
  for (let i = 0; i < 7; i++) {
    const entry = 6 + i * 16;
    const size = ico[entry] || 256;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    const data = ico.subarray(offset, offset + length);
    assertPngSize(data, size);
    assert(data.equals(await readFile(resolve(root, `public/logo/icons/${size}x${size}.png`))));
  }
  const icns = await readFile(resolve(root, "public/logo/icons/icon.icns"));
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  const frameSizes = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };
  const found = new Set();
  for (let offset = 8; offset < icns.length; ) {
    const type = icns.toString("ascii", offset, offset + 4);
    const length = icns.readUInt32BE(offset + 4);
    assert(length > 8 && offset + length <= icns.length);
    assertPngSize(icns.subarray(offset + 8, offset + length), frameSizes[type]);
    found.add(type);
    offset += length;
  }
  assert.equal(found.size, 7);
  for (const [name, data] of [
    ["ico", ico],
    ["icns", icns],
  ]) {
    for (const prefix of ["icon", "icon_installer"]) {
      assert(
        (await readFile(resolve(root, `packages/desktop/build/${prefix}.${name}`))).equals(data),
      );
    }
  }
});
