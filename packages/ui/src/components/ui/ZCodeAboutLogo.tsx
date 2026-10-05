import appLogoUrl from "@/assets/branding/czce-agent.svg";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={appLogoUrl}
      className={cn("size-24 shrink-0 object-contain", className)}
      data-product-icon="czce-agent"
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  const { intl } = useZCodeIntl();
  return (
    <span className={cn("text-ui-xl font-semibold", className)}>
      {intl.formatMessage({ id: "product.name" })}
    </span>
  );
}
