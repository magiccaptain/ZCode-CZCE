import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import { DEFAULT_INTERFACE_MODE } from "@/lib/interfaceMode.js";

export function useIsOfficeMode(): boolean {
  return useZCodeStoreWithDefault(
    (state) => state.interfaceMode === "office",
    DEFAULT_INTERFACE_MODE === "office",
  );
}
