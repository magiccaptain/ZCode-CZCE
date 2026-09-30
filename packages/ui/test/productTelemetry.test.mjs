import { existsSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const buildRequire = createRequire(
  createRequire(new URL("../../desktop/package.json", import.meta.url)).resolve("tsup"),
);
const { build } = await import(pathToFileURL(buildRequire.resolve("esbuild")).href);
const outfile = join(import.meta.dirname, "../../desktop/.e2e-cache/ui-telemetry-test.mjs");
await mkdir(join(import.meta.dirname, "../../desktop/.e2e-cache"), { recursive: true });
await build({
  stdin: {
    contents:
      [
        "appTelemetry",
        "planUsageArmsTelemetry",
        "chatErrorBannerTelemetry",
        "reactErrorArmsTelemetry",
        "uiPerfArmsTelemetry",
        "sendFunnelArmsTelemetry",
        "sessionOpenArmsTelemetry",
        "armsCustomEventObservability",
      ]
        .map((file) => `export * from '../src/lib/${file}.ts';`)
        .join("\n") +
      "\nexport { PlatformProvider } from '../src/hooks/usePlatform.tsx'; export { ConversationTelemetryWorkspaceAttachment } from '../src/v4/telemetry/ConversationTelemetryAttachment.tsx';",
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "ui-ports",
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) =>
          args.path === "@/logger.js"
            ? { path: args.path, namespace: "logger" }
            : {
                path: (() => {
                  const target = join(
                    import.meta.dirname,
                    "../src",
                    args.path.slice(2).replace(/\.js$/, ".ts"),
                  );
                  return existsSync(target) ? target : target + "x";
                })(),
              },
        );
        builder.onLoad({ filter: /.*/, namespace: "logger" }, () => ({
          contents:
            "export const logger={debug(){},warn(){throw Error('unexpected telemetry log')}}",
          loader: "js",
        }));
      },
    },
  ],
});
const ui = await import(pathToFileURL(outfile).href);
const platform = {
  productCapabilities: { telemetry: false },
  reportTelemetryEvent: () => assert.fail("business report"),
  reportArmsCustomEvent: () => assert.fail("ARMS report"),
};
test("UI disabled capability prevents context collection, reporters and E2E queue", async () => {
  await ui.reportAppTelemetryEvent(
    platform,
    { elementName: "test", eventExtraDetail: {}, eventRegion: "app", eventType: "result" },
    "test",
  );
  ui.setReactErrorArmsReporter(platform);
  ui.reportReactErrorToArms({ error: new Error("fixture"), componentStack: "fixture" });
  ui.setSendFunnelArmsReporter(platform);
  ui.reportSendFunnelInputFocus({ sessionId: null, focusTime: 1 });
  ui.setSessionOpenArmsReporter(platform);
  ui.reportSessionOpenStart({
    sessionOpenId: "fixture",
    sessionId: "fixture",
    openTrigger: "pane",
    openKind: "cold",
    clientMode: "desktop-continuous",
  });
  const host = {};
  ui.recordArmsCustomEventForE2E(
    { name: "fixture", group: "fixture" },
    { enabled: true, host, productCapabilities: platform.productCapabilities },
  );
  assert.deepEqual(host, {});
});

test("direct plan telemetry reporter cannot enqueue/export under disabled platform", () => {
  ui.reportPlanUsageTtftToArms(platform, { providerId: "fixture", ttftMs: 1 });
});

test("disabled workspace telemetry does not acquire service/supervisor", () => {
  const services = {
    get zcodeAgentService() {
      assert.fail("telemetry service read");
    },
  };
  const tree = createElement(
    ui.PlatformProvider,
    { platform },
    createElement(
      ui.ConversationTelemetryWorkspaceAttachment,
      { enabled: true, services, workspacePath: "fixture" },
      "conversation preserved",
    ),
  );
  assert.equal(renderToString(tree), "conversation preserved");
});
