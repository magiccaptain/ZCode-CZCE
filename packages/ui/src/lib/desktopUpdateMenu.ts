import {
  ZCODE_PRODUCT_FLAVOR,
  type ZCodeProductFlavor,
  type UpdateStatePayload,
  type ProductCapabilities,
} from "@zcode/shared";

// 显式产品能力优先于发布身份；未接入本地 Fork 的平台保留原有身份规则。
export function shouldShowDesktopUpdateEntry(
  flavor: ZCodeProductFlavor = ZCODE_PRODUCT_FLAVOR,
  capabilities?: ProductCapabilities,
): boolean {
  return capabilities ? capabilities.appUpdates : flavor === "production";
}

export function getUpdateMenuLabelId(state: UpdateStatePayload | null) {
  switch (state?.kind) {
    case "checking":
      return "desktopMenu.help.checkingForUpdates";
    case "update-available":
      return "desktopMenu.help.updateAvailableVersion";
    case "download-progress":
      return "desktopMenu.help.downloadingUpdateProgress";
    case "update-downloaded":
      return "desktopMenu.help.restartToUpdate";
    case "idle":
    default:
      return "titleBar.menu.help.checkForUpdates";
  }
}

export function getUpdateMenuLabelValues(
  state: UpdateStatePayload | null,
): Record<string, string> | undefined {
  switch (state?.kind) {
    case "update-available":
    case "update-downloaded":
      return { version: state.version };
    case "download-progress":
      return { progress: state.progress };
    default:
      return undefined;
  }
}
