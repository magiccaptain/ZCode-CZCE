import { REMOTE_WORKSPACES_UNAVAILABLE } from "@zcode/shared";

/** 同进程同步拒绝只关闭当前 attachment，未知异常继续交给原错误边界。 */
export function createRemoteEventAdmissionHandler(disposeAttachment: () => void) {
  return (error: unknown): boolean => {
    if (!(error instanceof Error) || error.message !== REMOTE_WORKSPACES_UNAVAILABLE) return false;
    // EventListen 不支持 Promise 拒绝响应；关闭 offending port，避免产品拒绝触发整个 Host fatal teardown。
    disposeAttachment();
    return true;
  };
}
