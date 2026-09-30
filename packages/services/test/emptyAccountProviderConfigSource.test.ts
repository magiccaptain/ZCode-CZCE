import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { decodeZCodeBuiltinRelease } from "@zcode/provider-node";
import { ModelConfigRules, ProviderConfigMap, type ProviderConfigSnapshot } from "@zcode/provider";
import { EmptyAccountProviderConfigSource } from "../src/model-provider/providerRuntime.js";
import type builtinData from "../../../config/provider/zcode-builtin.json";

interface WorkerRegistryView {
  readonly revision: string;
  readonly builtinRevision: string;
  readonly accountAccess: readonly [string, { readonly entitled: boolean }][];
  readonly apiKey: string;
  readonly endpoint: string;
}

test("disabled account source hot-syncs A→B to an already active Worker Registry and unsubscribes", async () => {
  const worker = new Worker(new URL("./fixtures/accountRegistryWorker.mjs", import.meta.url));
  let id = 0;
  const pending = new Map<
    number,
    { resolve: (value: WorkerRegistryView) => void; reject: (error: Error) => void }
  >();
  worker.on("message", (message) => {
    const request = pending.get(message.id)!;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });
  worker.on("error", (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  function request(method: string, input?: unknown): Promise<WorkerRegistryView> {
    return new Promise((resolve, reject) => {
      const nextId = ++id;
      pending.set(nextId, { resolve, reject });
      worker.postMessage({ id: nextId, method, input });
    });
  }
  const builtin: typeof builtinData = JSON.parse(
    await readFile(new URL("../../../config/provider/zcode-builtin.json", import.meta.url), "utf8"),
  );
  function snapshot(releaseInput: unknown, revision: string): ProviderConfigSnapshot {
    const release = decodeZCodeBuiltinRelease(releaseInput);
    return {
      revision,
      zcodeBuiltinRevision: String(release.revision),
      personalRevision: revision,
      zcodeBuiltinProviders: release.config.providers,
      zcodeBuiltinProviderTemplates: release.config.providerTemplates,
      zcodeBuiltinModelRules: release.config.modelConfigRules,
      personalProviders: ProviderConfigMap.empty(),
      personalModels: ModelConfigRules.empty(),
    };
  }
  let current = snapshot(builtin, "A");
  const listeners = new Set<(reason: string) => void>();
  const source = new EmptyAccountProviderConfigSource({
    async read() {
      return current;
    },
    onDidChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  let delivery = Promise.resolve();
  const notifications: string[] = [];
  // 与既有 active-client 路径一致：通知只排队，队列内读取，不预先捕获旧 overlay。
  const unsubscribe = source.onDidChange((reason) => {
    notifications.push(reason);
    delivery = delivery.then(async () => {
      const account = await source.read();
      await request("account", {
        ...account,
        providers: Object.fromEntries(
          account.providers.entries().map(([providerId, config]) => [providerId, config.toJSON()]),
        ),
      });
    });
  });
  try {
    assert.equal((await request("config", { release: builtin, revision: "A" })).revision, "A");
    const next = structuredClone(builtin);
    next.revision += 1;
    const template = next.config.providerConfigRules.templateRules.find(
      (rule) => rule.templateId === "deepseek",
    )!;
    template.config.api.baseUrl = "https://provider.example/b/v1";
    // 模拟 Worker 文件先到 B，overlay 仍 A；原 mismatch 边界必须保留整个 A。
    assert.equal((await request("config", { release: next, revision: "B" })).revision, "A");
    current = snapshot(next, "B");
    for (const listener of listeners) listener("builtin-B");
    await delivery;
    const updated = await request("read");
    assert.equal(updated.revision, "B", "active Worker must not stay on the entire old Registry");
    assert.equal(updated.endpoint, "https://provider.example/b/v1");
    assert.equal(updated.builtinRevision, String(next.revision));
    assert(updated.accountAccess.length > 0);
    assert(updated.accountAccess.every(([, access]) => access.entitled === false));
    assert.equal(
      (
        await request("config", {
          release: next,
          revision: "personal-C",
          apiKey: "fixture-local-key",
        })
      ).apiKey,
      "fixture-local-key",
    );
    current = snapshot(next, "personal-C");
    for (const listener of listeners) listener("personal-C");
    await delivery;
    assert.deepEqual(notifications, ["builtin-B", "personal-C"]);
    unsubscribe();
    for (const listener of listeners) listener("after-dispose");
    assert.deepEqual(notifications, ["builtin-B", "personal-C"]);
  } finally {
    unsubscribe();
    await worker.terminate();
  }
});
