import type { Logger } from "@zcode/contracts";
import {
  createMemorySampleWriteGate,
  memoryUsageToSampleFields,
  type MemorySample,
  type ZCodeProtocolNotification,
} from "@zcode/shared";
import {
  createZCodeProcessResourceSampler,
  type ZCodeProcessResourceSampler,
} from "../process-resource-sampler.js";
import type { ZCodeProtocolAgentServer } from "./server.js";

export function startProtocolResourceSampler(
  server: ZCodeProtocolAgentServer,
  _send: (message: ZCodeProtocolNotification) => void,
  logger: Logger,
): ZCodeProcessResourceSampler | undefined {
  try {
    // 本地内存诊断日志：复用同一 60s 节拍，
    // 变化/心跳门控后才写一行，避免与消息流同频刷盘。
    const memoryDiagnosticsGate = createMemorySampleWriteGate();
    const sampler = createZCodeProcessResourceSampler({
      onMemorySample: (memoryUsage) => {
        // 根因：维护节拍不能随产品遥测一起删，改为纯本地诊断回调，不发协议资源样本。
        // resident session TTL / 水位收敛借用原 60s 节拍作兜底，不新增定时器；
        // sampler 对诊断回调有异常兜底，单次 rebalance 失败不影响 Agent 主循环。
        server.rebalanceResidentSessions();
        try {
          // 同一节拍先做瞬态事件时间兜底淘汰，再采样，日志里的 eventRows 反映淘汰后的驻留量。
          server.pruneSessionEventStores();
          server.pruneDetachedChildPublishers();
        } catch {
          // 兜底淘汰失败不影响本地诊断日志。
        }
        try {
          const memorySample: MemorySample = {
            role: "agent_node",
            ...memoryUsageToSampleFields(memoryUsage),
            counters: server.collectMemoryDiagnostics(),
          };
          const reason = memoryDiagnosticsGate.evaluate(memorySample, Date.now());
          if (reason) {
            const { role: _role, counters, ...memoryFields } = memorySample;
            logger.info("Process memory sample", {
              event: "zcode_protocol.process.memory_sample",
              reason,
              ...memoryFields,
              counters,
            });
          }
        } catch {
          // 诊断日志失败只丢当前样本，不影响 rebalance。
        }
      },
    });
    sampler.start();
    return sampler;
  } catch {
    // 本地诊断是 best effort，初始化失败不能改变 Agent 启动结果。
    return undefined;
  }
}
