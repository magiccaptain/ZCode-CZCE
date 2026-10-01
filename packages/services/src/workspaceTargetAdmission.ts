import { assertWorkspaceTargetAvailable, type RemoteProductCapabilities } from "@zcode/shared";
import type { IZCodeTaskService } from "./session/zcodeTaskService.js";

type WorkspaceTarget = Parameters<typeof assertWorkspaceTargetAvailable>[1];

/** 装配边界先裁决显式入站目标，业务 owner 和内部事件仍留在原 service。 */
export function withWorkspaceTargetAdmission<T extends object>(
  service: T,
  capabilities: RemoteProductCapabilities | undefined,
  nestedTargets?: (method: PropertyKey, params: object) => readonly WorkspaceTarget[],
): T {
  if (capabilities?.remoteWorkspaces !== false) return service;
  return new Proxy(service, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const params = args[0];
        if (params && typeof params === "object") {
          // Agent guard 太晚会让 Task 先写缓存/索引或准备 MCP；消费者共享同源 admission，而非失败后 rollback。
          assertWorkspaceTargetAvailable(capabilities, params);
          for (const scope of nestedTargets?.(property, params) ?? [])
            assertWorkspaceTargetAvailable(capabilities, scope);
        }
        return value.apply(target, args);
      };
    },
  });
}

type ScopedTaskMethod =
  | "listTaskList"
  | "listGroupedTaskViewStructure"
  | "renameTaskGroup"
  | "updateTaskGroupColor"
  | "deleteTaskGroup";

/** 只解释当前 Task typed 契约中的集合目标，不递归扫描任意业务 payload。 */
export function taskWorkspaceTargets(
  method: PropertyKey,
  params: object,
): readonly WorkspaceTarget[] {
  switch (method) {
    case "listTaskList":
    case "listGroupedTaskViewStructure":
    case "renameTaskGroup":
    case "updateTaskGroupColor":
    case "deleteTaskGroup":
      return (params as Parameters<IZCodeTaskService[ScopedTaskMethod]>[0]).workspaceScopes ?? [];
    case "applyGroupedTaskViewOrder": {
      const input = params as Parameters<IZCodeTaskService["applyGroupedTaskViewOrder"]>[0];
      return [
        ...(input.workspaceScopes ?? []),
        ...(input.topLevelNodes ?? []).flatMap((node) => (node.type === "task" ? [node.task] : [])),
        ...(input.groups ?? []).flatMap((group) => group.taskRefs),
      ];
    }
    default:
      return [];
  }
}
