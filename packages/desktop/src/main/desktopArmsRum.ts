import { createRequire } from "node:module";
import type armsRum from "@arms/rum-electron";
import { DESKTOP_PRODUCT_CAPABILITIES } from "./productCapabilities.js";

let sdk: typeof armsRum | undefined;

/** SDK 模块导入本身会创建 client 并注册 Electron scheme，必须在产品裁决之后加载。 */
export function getDesktopArmsRum(): typeof armsRum {
  if (!DESKTOP_PRODUCT_CAPABILITIES.telemetry) {
    throw new Error("Product telemetry is disabled");
  }
  sdk ??= createRequire(import.meta.url)("@arms/rum-electron") as typeof armsRum;
  return sdk;
}
