import { DESKTOP_PRODUCT_CAPABILITIES } from "./productCapabilities.js";
import type { TelemetryRendererContext } from "@zcode/shared";

interface StartupCoordinatorLike {
  onRendererReady(input: { hasPendingOAuthCallback: boolean; rendererId: number }): boolean;
  onOAuthCallbackHandled(input: { rendererId: number }): boolean;
}

interface TelemetryCoreLike {
  reportAppLaunch(context: TelemetryRendererContext): Promise<void>;
  reportAppDailyActive(context: TelemetryRendererContext): Promise<void>;
}

type DailyActiveInterval = ReturnType<typeof setInterval> | number;

interface AppTelemetryRuntimeDependencies {
  telemetryCore: TelemetryCoreLike;
  appLaunchCoordinator: StartupCoordinatorLike;
  onError?: (error: unknown) => void;
  dailyActiveHeartbeatIntervalMs?: number;
  setInterval?: (handler: () => void, timeout: number) => DailyActiveInterval;
  clearInterval?: (interval: DailyActiveInterval) => void;
}

const DEFAULT_DAILY_ACTIVE_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

export function createAppTelemetryRuntime({
  telemetryCore,
  appLaunchCoordinator,
  onError,
  dailyActiveHeartbeatIntervalMs = DEFAULT_DAILY_ACTIVE_HEARTBEAT_INTERVAL_MS,
  setInterval: setIntervalFn = setInterval,
  clearInterval: clearIntervalFn = clearInterval,
}: AppTelemetryRuntimeDependencies) {
  // 产品能力必须先于环境、旧配置和遥测副作用裁决。
  if (!DESKTOP_PRODUCT_CAPABILITIES.telemetry)
    return {
      syncRendererContext(): void {},
      getLatestRendererContext(): TelemetryRendererContext | null {
        return null;
      },
      getRendererContext(): TelemetryRendererContext | null {
        return null;
      },
      setInteractive(): void {},
      onRendererReady(input: { hasPendingOAuthCallback: boolean; rendererId: number }): void {
        appLaunchCoordinator.onRendererReady(input);
      },
      onOAuthCallbackHandled(input: { rendererId: number }): void {
        appLaunchCoordinator.onOAuthCallbackHandled(input);
      },
      dispose(): void {},
    };
  const rendererContexts = new Map<number, TelemetryRendererContext>();
  let pendingStartupTelemetryRendererId: number | null = null;
  let latestRendererContext: TelemetryRendererContext | null = null;
  let interactive = false;

  function reportDailyActive(context: TelemetryRendererContext): void {
    void telemetryCore.reportAppDailyActive(context).catch((error) => {
      onError?.(error);
    });
  }

  function maybeReportDailyActive(): void {
    if (!interactive || latestRendererContext == null) {
      return;
    }

    reportDailyActive(latestRendererContext);
  }

  const dailyActiveHeartbeat = setIntervalFn(
    maybeReportDailyActive,
    dailyActiveHeartbeatIntervalMs,
  );
  if (typeof dailyActiveHeartbeat === "object") {
    dailyActiveHeartbeat.unref?.();
  }

  function flushStartupTelemetry(): void {
    if (pendingStartupTelemetryRendererId == null) {
      return;
    }

    const context = rendererContexts.get(pendingStartupTelemetryRendererId);
    if (context == null) {
      return;
    }

    pendingStartupTelemetryRendererId = null;
    void telemetryCore.reportAppLaunch(context).catch((error) => {
      onError?.(error);
    });
    reportDailyActive(context);
  }

  function markStartupTelemetryPending(rendererId: number): void {
    pendingStartupTelemetryRendererId = rendererId;
    flushStartupTelemetry();
  }

  return {
    syncRendererContext(input: { rendererId: number; context: TelemetryRendererContext }): void {
      rendererContexts.set(input.rendererId, input.context);
      latestRendererContext = input.context;
      flushStartupTelemetry();
    },

    getLatestRendererContext(): TelemetryRendererContext | null {
      return latestRendererContext;
    },

    getRendererContext(rendererId: number): TelemetryRendererContext | null {
      return rendererContexts.get(rendererId) ?? null;
    },

    setInteractive(nextInteractive: boolean): void {
      const becameInteractive = !interactive && nextInteractive;
      interactive = nextInteractive;
      if (becameInteractive) {
        maybeReportDailyActive();
      }
    },

    onRendererReady(input: { hasPendingOAuthCallback: boolean; rendererId: number }): void {
      if (appLaunchCoordinator.onRendererReady(input)) {
        markStartupTelemetryPending(input.rendererId);
      }
    },

    onOAuthCallbackHandled(input: { rendererId: number }): void {
      if (appLaunchCoordinator.onOAuthCallbackHandled(input)) {
        markStartupTelemetryPending(input.rendererId);
      }
    },

    dispose(): void {
      clearIntervalFn(dailyActiveHeartbeat);
    },
  };
}
