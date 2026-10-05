import assert from "node:assert/strict";
import test from "node:test";
import * as interfaceMode from "../src/lib/interfaceMode.js";

test("a new user defaults to office mode", () => {
  assert.equal(interfaceMode.normalizeInterfaceMode(null), "office");
  assert.equal(interfaceMode.normalizeInterfaceMode(undefined), "office");
});

test("invalid stored preferences use the office default", () => {
  for (const value of ["", "unknown", "OFFICE", false, 0, {}, []]) {
    assert.equal(interfaceMode.normalizeInterfaceMode(value), "office");
  }
});

test("explicit coding and office preferences are preserved", () => {
  assert.equal(interfaceMode.normalizeInterfaceMode("coding"), "coding");
  assert.equal(interfaceMode.normalizeInterfaceMode("office"), "office");
});

test("legacy general and concise preferences remain office mode", () => {
  assert.equal(interfaceMode.normalizeInterfaceMode("general"), "office");
  assert.equal(interfaceMode.normalizeInterfaceMode("concise"), "office");
});
