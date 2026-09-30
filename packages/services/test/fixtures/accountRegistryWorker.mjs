import { parentPort } from "node:worker_threads";
import { register } from "tsx/esm/api";
register();
const {
  ProviderRegistryService,
  MutableAccountProviderConfigSource,
  parseAccountProviderConfigMap,
  createFailClosedAccountProviderConfigSnapshot,
  parsePersonalProviderConfigMap,
  ModelConfigRules,
} = await import("@zcode/provider");
const { decodeZCodeBuiltinRelease } = await import("@zcode/provider-node");
let config;
const listeners = new Set();
const configSource = {
  async read() {
    return config;
  },
  onDidChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
const accountSource = new MutableAccountProviderConfigSource();
const registry = new ProviderRegistryService({ configSource, accountSource });
let queue = Promise.resolve();
parentPort.on("message", ({ id, method, input }) => {
  queue = queue.then(async () => {
    try {
      if (method === "config") {
        const release = decodeZCodeBuiltinRelease(input.release);
        config = {
          revision: input.revision,
          zcodeBuiltinRevision: String(release.revision),
          personalRevision: input.revision,
          zcodeBuiltinProviders: release.config.providers,
          zcodeBuiltinProviderTemplates: release.config.providerTemplates,
          zcodeBuiltinModelRules: release.config.modelConfigRules,
          personalProviders: parsePersonalProviderConfigMap({
            providerRules: [
              {
                providerId: "local-fixture",
                templateId: "deepseek",
                config: {
                  group: "standard-personal",
                  access: { type: "api-key", apiKey: input.apiKey ?? "fixture-A" },
                },
              },
            ],
          }),
          personalModels: ModelConfigRules.empty(),
        };
        if (!registry.getSnapshot())
          accountSource.replace(createFailClosedAccountProviderConfigSnapshot(config));
        for (const listener of listeners) listener("config-changed");
      } else if (method === "account") {
        accountSource.replace({
          ...input,
          providers: parseAccountProviderConfigMap(input.providers),
        });
      }
      if (!registry.getSnapshot()) await registry.start();
      const snapshot = await registry.refresh("test-barrier");
      parentPort.postMessage({
        id,
        result: {
          revision: snapshot.config.revision,
          builtinRevision: snapshot.account.basedOnZCodeBuiltinRevision,
          accountAccess: snapshot.account.providers
            .entries()
            .map(([providerId, provider]) => [providerId, provider.access.toJSON()]),
          apiKey: registry.getProvider("local-fixture").config.access.apiKey,
          endpoint: registry.getProvider("local-fixture").config.api.baseUrl,
        },
      });
    } catch (error) {
      parentPort.postMessage({ id, error: error.stack });
    }
  });
});
