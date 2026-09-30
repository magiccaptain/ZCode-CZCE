import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useModelProviders } from "@/hooks/useModelProviders.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import { sortModelProvidersForDisplay } from "@/lib/modelProviderOrdering.js";
import {
  addPendingSettingsSectionListener,
  consumePendingSettingsModelProviderTarget,
  type SettingsModelProviderTarget,
} from "@/lib/settingsNavigation.js";
import { InlineEditableProviderCard } from "./model-provider-section/InlineEditableProviderCard.js";
import { ModelProviderSectionLayout } from "./model-provider-section/SectionLayout.js";
import { ProviderTemplatePicker } from "./model-provider-section/ProviderTemplatePicker.js";
import { confirmAndDeleteModelProvider } from "./model-provider-section/modelProviderActions.js";
import type { ModelProviderNavGroup } from "./model-provider-section/constants.js";

/** 本地视图只投影服务事实；不要在此恢复账号凭据或替代 Registry 的可执行判断。 */
export function LocalModelProviderSection({
  workspacePath = "",
  connectivityWorkspacePath,
  connectivityWorkspaceRequired = false,
  pendingModelProviderTarget,
  onConsumePendingModelProviderTarget,
}: {
  workspacePath?: string;
  connectivityWorkspacePath?: string;
  connectivityWorkspaceRequired?: boolean;
  pendingModelProviderTarget?: SettingsModelProviderTarget;
  onConsumePendingModelProviderTarget?: () => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const models = useModelProviders({
    workspacePath,
    connectivityWorkspacePath,
    connectivityWorkspaceRequired,
    connectivityUnavailableMessage: intl.formatMessage({
      id: "settings.modelProvider.testModel.localWorkspaceUnavailable",
    }),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [oldAccountTarget, setOldAccountTarget] = useState(() =>
    Boolean(consumePendingSettingsModelProviderTarget()),
  );
  useEffect(() => {
    if (!pendingModelProviderTarget) return;
    setOldAccountTarget(true);
    onConsumePendingModelProviderTarget?.();
  }, [pendingModelProviderTarget, onConsumePendingModelProviderTarget]);
  useEffect(
    () =>
      addPendingSettingsSectionListener((section, detail) => {
        if (section === "modelProvider" && detail?.modelProviderId) setOldAccountTarget(true);
      }),
    [],
  );
  const providers = useMemo(
    () =>
      sortModelProvidersForDisplay(
        models.modelProviders.filter(
          (provider) => provider.config.access?.type !== "zhipu-account",
        ),
        models.displayOrder,
      ),
    [models.modelProviders, models.displayOrder],
  );
  const selected = providers.find((provider) => provider.providerId === selectedId) ?? providers[0];
  const navigationGroups: ModelProviderNavGroup[] = [
    {
      id: "custom",
      title: intl.formatMessage({ id: "settings.modelProvider.customTitle" }),
      items: providers.map((provider) => ({
        type: "custom",
        key: provider.providerId,
        label: getProviderFormLabel(provider),
        provider,
        statusActive: provider.executable,
      })),
    },
  ];
  const createProvider = async (input: { templateId?: string; providerName?: string }) => {
    setCreating(true);
    try {
      const provider = await models.createPersonalProvider({ ...input, locale });
      setSelectedId(provider.providerId);
      setPickerOpen(false);
      setOldAccountTarget(false);
    } finally {
      setCreating(false);
    }
  };
  return (
    <ModelProviderSectionLayout
      description={intl.formatMessage({ id: "settings.modelProviderDescription" })}
      refreshLabel={intl.formatMessage({ id: "settings.modelProvider.refresh" })}
      loadingLabel={intl.formatMessage({ id: "common.loading" })}
      presetLoading={false}
      customLoading={models.loading || models.refreshing}
      onRefresh={() => void models.refresh()}
      addProviderLabel={intl.formatMessage({ id: "settings.modelProvider.addProviderAction" })}
      onAddProvider={() => setPickerOpen(true)}
      navigationGroups={navigationGroups}
      selectedNodeKey={selected?.providerId ?? null}
      onSelectNavItem={(item) => {
        setSelectedId(item.key);
        setPickerOpen(false);
      }}
      reorderableProviderIds={models.reorderableProviderIds}
      onReorderProviderIds={async (providerIds) => {
        // 本地列表隐藏账号项；只调整显式拖动的分组，不能借排序清掉旧账号顺序。
        const moved = new Set(providerIds);
        const current = sortModelProvidersForDisplay(
          models.modelProviders,
          models.displayOrder,
        ).map((provider) => provider.providerId);
        const index = current.findIndex((id) => moved.has(id));
        if (index < 0) return;
        const next = current.filter((id) => !moved.has(id));
        next.splice(index, 0, ...providerIds);
        await models.saveDisplayOrder({ providerIds: next });
      }}
    >
      {oldAccountTarget || !selected ? (
        <p role="status" className="mb-3 text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.localConfigurationHint" })}
        </p>
      ) : null}
      {models.loadError ? (
        <div role="alert" className="text-ui-base text-destructive">
          {models.loadError.message}
          <Button variant="outline" onClick={models.reload}>
            {intl.formatMessage({ id: "common.retry" })}
          </Button>
        </div>
      ) : pickerOpen ? (
        <ProviderTemplatePicker
          templates={models.providerTemplates}
          creating={creating}
          onBack={() => setPickerOpen(false)}
          onCreateFromTemplate={(templateId) => createProvider({ templateId })}
          onCreateCustom={(providerName) => createProvider({ providerName })}
        />
      ) : selected ? (
        <InlineEditableProviderCard
          key={selected.providerId}
          provider={selected}
          settingsRevision={models.providerSettingsView?.revision}
          onSave={async (provider) => {
            await models.saveProvider(provider);
          }}
          onAddPersonalModel={models.addPersonalModel}
          onSavePersonalModelDraft={models.savePersonalModelDraft}
          onSetPersonalModelEnabled={models.setPersonalModelEnabled}
          onDeletePersonalModel={models.deletePersonalModel}
          onTestModel={models.testModelConnectivity}
          onReorderModelIds={(modelIds) =>
            models.reorderProviderModels(selected.providerId, modelIds)
          }
          onDelete={
            selected.config.group === "standard-personal"
              ? () =>
                  confirmAndDeleteModelProvider({
                    provider: selected,
                    confirmDialog,
                    intl,
                    deleteProvider: models.deleteProvider,
                  })
              : undefined
          }
        />
      ) : null}
    </ModelProviderSectionLayout>
  );
}
