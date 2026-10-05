export type InterfaceMode = "office" | "coding";

export const DEFAULT_INTERFACE_MODE: InterfaceMode = "office";
export const INTERFACE_MODE_STORAGE_KEY = "zcode-interface-mode";

export function normalizeInterfaceMode(value: unknown): InterfaceMode {
  // 首次启动或偏好无效时默认办公模式；保留用户明确保存的编程模式。
  // 旧值 general/concise 继续映射到 office，避免改变存量用户的选择。
  if (value === "coding" || value === "office") return value;
  if (value === "general" || value === "concise") return "office";
  return DEFAULT_INTERFACE_MODE;
}
