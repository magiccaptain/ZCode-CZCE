import type { DockerContainerInfo, IPlatformService } from "@zcode/shared";
import { REMOTE_WORKSPACES_UNAVAILABLE } from "@zcode/shared";

type DockerOptionsPlatform = Pick<
  IPlatformService,
  "isDockerAvailable" | "listDockerContainers" | "productCapabilities"
>;

interface RemoteConnectionDockerOptionsResult {
  dockerAvailable: boolean | null;
  dockerContainers: DockerContainerInfo[];
  error: string;
}

export async function loadRemoteConnectionDockerOptions(
  platform: DockerOptionsPlatform,
): Promise<RemoteConnectionDockerOptionsResult> {
  // 直接复用发现 helper 的旧调用者也要先裁决，不能等 Main 拒绝才停止 UI 探测。
  if (platform.productCapabilities?.remoteWorkspaces === false) {
    return { dockerAvailable: false, dockerContainers: [], error: REMOTE_WORKSPACES_UNAVAILABLE };
  }
  try {
    const dockerAvailable = await platform.isDockerAvailable();
    if (!dockerAvailable) {
      return {
        dockerAvailable: false,
        dockerContainers: [],
        error: "",
      };
    }

    const dockerContainers = await platform.listDockerContainers();
    return {
      dockerAvailable: true,
      dockerContainers,
      error: "",
    };
  } catch (runtimeError) {
    return {
      dockerAvailable: null,
      dockerContainers: [],
      error: String(runtimeError),
    };
  }
}

export function resolveDockerContainerSelectionAfterRefresh({
  currentContainer,
  dockerContainers,
}: {
  currentContainer: string;
  dockerContainers: DockerContainerInfo[];
}): string {
  const selectedContainer = currentContainer.trim();
  if (!selectedContainer) {
    return "";
  }

  const selectedContainerStillRunning = dockerContainers.some(
    (container) => container.name === selectedContainer || container.id === selectedContainer,
  );

  return selectedContainerStillRunning ? selectedContainer : "";
}
