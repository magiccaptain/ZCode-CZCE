import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 陷阱 owner 覆盖对话、工具、恢复和退出，仅持久化脱敏计数。 */
export async function createTelemetryFixture(runRoot) {
  let requests = 0;
  const trap = createServer((_req, res) => {
    requests++;
    res.writeHead(500);
    res.end();
  });
  await new Promise((resolve) => trap.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${trap.address().port}`;
  const state = join(runRoot, ".zcode/v2/telemetry-state.json");
  const bytes = '{"pending":"LEGACY_TELEMETRY_MARKER"}';
  await mkdir(join(runRoot, ".zcode/v2"), { recursive: true });
  await writeFile(state, bytes);
  return {
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${endpoint}/v1/metrics`,
      ZCODE_MODEL_TELEMETRY_ENABLED: "1",
      ZCODE_TELEMETRY_ENABLED: "1",
      ZCODE_LOCAL_TTFT_ENABLED: "1",
      ZCODE_RENDERER_ACTION_TRACE_ENABLED: "1",
    },
    async assertRenderer(page) {
      assert.equal(await page.evaluate(() => window.zcode.productCapabilities.telemetry), false);
      assert.equal(
        await page.evaluate(() => Boolean(window.RumSDK || window.__zcodeArmsCustomEventsE2E)),
        false,
      );
    },
    async verify(log) {
      assert.equal(requests, 0);
      // 共享 identity 也服务非遥测消费者；缺失时仅允许补 deviceMid，不恢复产品队列。
      const { deviceMid, ...preserved } = JSON.parse(await readFile(state, "utf8"));
      assert.match(deviceMid, /^[a-f0-9-]{36}$/);
      assert.deepEqual(preserved, JSON.parse(bytes));
      assert(
        !log.some((line) =>
          /\[arms\] electron initialized|\[network\] reporting started|\[resource\] sampling started/.test(
            line,
          ),
        ),
      );
      return {
        explicitOtelRequests: 0,
        legacyFieldsPreserved: true,
        onlySharedIdentityAdded: true,
        rendererSdkAbsent: true,
      };
    },
    close: () =>
      new Promise((resolve) => {
        trap.closeAllConnections();
        trap.close(resolve);
      }),
  };
}
