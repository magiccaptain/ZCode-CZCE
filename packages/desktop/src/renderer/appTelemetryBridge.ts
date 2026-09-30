import type { TelemetryRendererContext } from "@zcode/shared";

interface AppTelemetryBridge {
  syncTelemetryContext(context: TelemetryRendererContext): void;
}

interface AppTelemetryBridgeDependencies {
  productCapabilities?: Pick<import("@zcode/shared").ProductCapabilities, "telemetry">;
  bridge: AppTelemetryBridge;
  createRendererContext: () => TelemetryRendererContext;
}

export function syncAppTelemetryContext({
  productCapabilities,
  bridge,
  createRendererContext,
}: AppTelemetryBridgeDependencies): void {
  if (productCapabilities?.telemetry === false) return;
  bridge.syncTelemetryContext(createRendererContext());
}
