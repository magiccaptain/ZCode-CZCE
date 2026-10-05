import type { ZCodeProvider } from "@zcode/shared";
import { GlmMonochromeIcon } from "@/components/ui/GlmMonochromeIcon.js";

export function renderProviderCliIcon(_provider: ZCodeProvider = "glm", className?: string) {
  // provider 是底层运行时标识；任务与会话展示的是当前产品的 Agent 图标。
  return <GlmMonochromeIcon className={className} />;
}
