import { ZCODE_CLI_RESOURCE_SAMPLE_INTERVAL_MS } from "@zcode/shared";

/** 本地内存诊断和会话存储维护共用原节拍，不再生成产品资源样本。 */
interface ProcessMemoryUsageSnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface ResourceSamplerTimerHandle {
  unref?(): void;
}
interface ResourceSamplerTimer {
  setInterval(callback: () => void, intervalMs: number): ResourceSamplerTimerHandle;
  clearInterval(handle: ResourceSamplerTimerHandle): void;
}
interface CreateZCodeProcessResourceSamplerOptions {
  onMemorySample(memoryUsage: ProcessMemoryUsageSnapshot): void;
  readMemoryUsage?: () => ProcessMemoryUsageSnapshot;
  timer?: ResourceSamplerTimer;
}

export interface ZCodeProcessResourceSampler {
  start(): void;
  stop(): void;
}

export function createZCodeProcessResourceSampler(
  options: CreateZCodeProcessResourceSamplerOptions,
): ZCodeProcessResourceSampler {
  // 根因：原产品采样节拍兼做 resident TTL 与本地诊断，直接删除会丢失会话维护。
  // 仅保留 memoryUsage 与原维护回调，不读取 CPU/主机指标、不生成 telemetry token/样本。
  const readMemoryUsage = options.readMemoryUsage ?? (() => process.memoryUsage());
  const timer = options.timer ?? {
    setInterval: (callback: () => void, intervalMs: number) => setInterval(callback, intervalMs),
    clearInterval: (handle: ResourceSamplerTimerHandle) => clearInterval(handle as NodeJS.Timeout),
  };
  let handle: ResourceSamplerTimerHandle | undefined;
  return {
    start() {
      if (handle) return;
      try {
        handle = timer.setInterval(() => {
          try {
            options.onMemorySample(readMemoryUsage());
          } catch {
            // 本地诊断失败不改变 Agent 主循环。
          }
        }, ZCODE_CLI_RESOURCE_SAMPLE_INTERVAL_MS);
        handle.unref?.();
      } catch {
        // timer 不可用不阻断原启动链，保留已取得的 handle 供 stop 回收。
      }
    },
    stop() {
      const active = handle;
      handle = undefined;
      try {
        if (active) timer.clearInterval(active);
      } catch {
        // 本地诊断清理失败不能阻断 CLI 退出。
      }
    },
  };
}
