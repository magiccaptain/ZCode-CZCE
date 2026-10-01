import type { ProductCapabilities } from "./productCapabilities.js";
import { isRemoteWorkspaceIdentity } from "./remote-workspace-identity.js";

/** 产品组装层传入只读能力；缺省保留其他产品的既有远程语义。 */
export type RemoteProductCapabilities = Readonly<
  Partial<Pick<ProductCapabilities, "remoteWorkspaces" | "mobileRemoteControl">>
>;
export const REMOTE_WORKSPACES_UNAVAILABLE = "REMOTE_WORKSPACES_UNAVAILABLE";
export const MOBILE_REMOTE_CONTROL_UNAVAILABLE = "MOBILE_REMOTE_CONTROL_UNAVAILABLE";

export function assertRemoteWorkspacesAvailable(capabilities?: RemoteProductCapabilities): void {
  if (capabilities?.remoteWorkspaces === false) throw new Error(REMOTE_WORKSPACES_UNAVAILABLE);
}

export function assertMobileRemoteControlAvailable(capabilities?: RemoteProductCapabilities): void {
  if (capabilities?.mobileRemoteControl === false)
    throw new Error(MOBILE_REMOTE_CONTROL_UNAVAILABLE);
}

/** 旧远端 scope 不得剥离 identity 后落到同路径的本地 Runtime。 */
export function assertWorkspaceTargetAvailable(
  capabilities: RemoteProductCapabilities | undefined,
  target: { workspaceIdentity?: string; remoteSessionId?: string },
): void {
  // 未禁用能力的产品仍由原协议 owner 校验入参，不能新增预解析改变错误语义。
  if (capabilities?.remoteWorkspaces !== false) return;
  if (
    target.remoteSessionId ||
    // 身份 key 原本会 trim；执行 guard 必须同样归一化，避免旧空白 identity 绕过关闭。
    (target.workspaceIdentity && isRemoteWorkspaceIdentity(target.workspaceIdentity.trim()))
  )
    assertRemoteWorkspacesAvailable(capabilities);
}

export function assertHostAttachmentAvailable(
  capabilities: RemoteProductCapabilities | undefined,
  attachment: {
    scope: { kind: "local" | "remote" };
    clientMode: "desktop-continuous" | "web-remote-replayable";
  },
): void {
  if (attachment.scope.kind === "remote") assertRemoteWorkspacesAvailable(capabilities);
  if (attachment.clientMode === "web-remote-replayable")
    assertMobileRemoteControlAvailable(capabilities);
}
