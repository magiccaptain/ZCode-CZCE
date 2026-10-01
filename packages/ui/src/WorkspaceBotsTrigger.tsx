import { useState } from "react";
import { Bot } from "lucide-react";
import { BotsDialog } from "@/BotsDialog.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 本地 Bot 配置独立于已关闭的手机远控包装，不新增服务状态。 */
export function WorkspaceBotsTrigger({
  workspacePath,
  workspaceIdentity,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const { intl } = useZCodeIntl();
  const [open, setOpen] = useState(false);
  const title = intl.formatMessage({ id: "bots.title" });
  return (
    <>
      <ControlHintTooltip title={title}>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={title}
          data-testid="workspace-bots-trigger"
          onClick={() => setOpen(true)}
        >
          <Bot className="size-4 text-foreground-subtle" />
        </Button>
      </ControlHintTooltip>
      {open ? (
        <BotsDialog
          open={open}
          onOpenChange={setOpen}
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
        />
      ) : null}
    </>
  );
}
