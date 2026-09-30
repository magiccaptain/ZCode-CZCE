import { type ApiClient } from "@zcode/shared";
import {
  assertProductAccountEnabled,
  type AccountProductCapabilities,
} from "../productAccountBoundary.js";
import { readApiJson } from "../providers/api/apiJson.js";
import type { RemoteEnvelope } from "./accountProviderApiTypes.js";

function isSuccessfulRemoteCode(code: unknown): boolean {
  if (code === null || code === undefined) {
    return true;
  }
  if (typeof code === "number") {
    return code === 0 || code === 200;
  }
  if (typeof code === "string") {
    return code === "0" || code === "200";
  }
  return false;
}

export class AccountProviderApiClient {
  constructor(
    readonly apiClient: ApiClient,
    readonly productCapabilities?: AccountProductCapabilities,
  ) {}

  async fetchRemoteData<T>(url: string, init: RequestInit): Promise<T | null> {
    assertProductAccountEnabled(this.productCapabilities);
    const payload = await readApiJson<RemoteEnvelope<T>>(this.apiClient, url, init);
    // BigModel 部分业务接口成功时返回 code=200，而不是 code=0。
    if (!isSuccessfulRemoteCode(payload.code)) {
      return null;
    }

    return payload.data ?? null;
  }
}
