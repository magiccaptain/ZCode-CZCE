import type { ImgHTMLAttributes } from "react";
import appLogoUrl from "@/assets/branding/czce-agent.svg";
import { cn } from "@/components/lib/utils.js";

type GlmMonochromeIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export function GlmMonochromeIcon({
  className,
  alt = "",
  style,
  ...props
}: GlmMonochromeIconProps) {
  // 旧名称仅用于兼容 Agent 图标调用；产品图标保留官方蓝黄配色，不再去色。
  return (
    <img
      src={appLogoUrl}
      data-product-icon="czce-agent"
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={cn("shrink-0 object-contain", className)}
      style={style}
      {...props}
    />
  );
}
