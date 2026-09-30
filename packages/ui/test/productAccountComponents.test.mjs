import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(
  createRequire(new URL("../../desktop/package.json", import.meta.url)).resolve("tsup"),
);
const { build } = await import(pathToFileURL(require.resolve("esbuild")).href);
const outfile = join(
  import.meta.dirname,
  "../../desktop/.e2e-cache/ui-account-components-test.mjs",
);
await mkdir(join(import.meta.dirname, "../../desktop/.e2e-cache"), { recursive: true });
await build({
  stdin: {
    contents:
      "export * from '../src/ChatErrorBanner.tsx'; export * from '../src/settings/CodingPlanUpgradeDialogProvider.tsx';",
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
        builder.onResolve({ filter: /^react$/ }, (args) => ({ path: args.path, external: true }));
        builder.onResolve({ filter: /^@\// }, (args) => {
          if (args.path === "@/lib/providerBusinessError.js")
            return { path: join(import.meta.dirname, "../src/lib/providerBusinessError.ts") };
          return { path: args.path, namespace: "ports" };
        });
        builder.onResolve(
          {
            filter:
              /IntlProvider\.js$|components\/ui\/button\.js$|components\/ui\/dialog\.js$|toast\.js$|utils\.js$/,
          },
          (args) => ({ path: args.path, namespace: "ports" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "ports" }, (args) => ({
          loader: "js",
          contents: args.path.includes("usePlatform")
            ? "export const usePlatform=()=>globalThis.__accountPlatform; export const useOptionalPlatform=usePlatform;"
            : args.path.includes("useCodingPlanEntryPlanList")
              ? "export const useCodingPlanEntryPlanList=()=>{throw Error('inventory query started')};"
              : args.path.endsWith("CodingPlanUpgradeDialog.js")
                ? "export const CodingPlanUpgradeDialog=()=>{throw Error('purchase dialog mounted')};"
                : args.path.endsWith("CodingPlanEntryButton.js")
                  ? "export const CodingPlanEntryButton=()=>null;"
                  : args.path.endsWith("IntlProvider.js")
                    ? "export const useZCodeIntl=()=>({intl:{formatMessage:({id})=>id}});"
                    : args.path.endsWith("feedbackStore.js")
                      ? "export const useFeedbackStore=()=>()=>{};"
                      : args.path.endsWith("providerBusinessError.js")
                        ? ""
                        : args.path.endsWith("utils.js")
                          ? "export const cn=(...args)=>args.join(' ');"
                          : args.path.endsWith("toast.js")
                            ? "export const toast=()=>{};"
                            : args.path.endsWith("button.js")
                              ? "import {createElement} from 'react'; export const Button=({children,...props})=>createElement('button',props,children);"
                              : args.path.endsWith("dialog.js")
                                ? "export const Dialog=()=>null; export const DialogContent=()=>null; export const DialogHeader=()=>null; export const DialogTitle=()=>null; export const DialogDescription=()=>null;"
                                : "export const reportCodingPlanUpgradeClick=()=>{}; export const buildErrorFeedbackDescription=()=>'';",
        }));
      },
    },
  ],
});
const ui = await import(pathToFileURL(outfile).href);
const intl = { formatMessage: ({ id }) => id };
test("Disabled account/subscription provider rejects old purchase commands before inventory or webview mount", () => {
  for (const productCapabilities of [{ productAccount: false }, { productSubscription: false }]) {
    globalThis.__accountPlatform = { productCapabilities };
    let opened;
    function Consumer() {
      const dialog = ui.useCodingPlanUpgradeDialog();
      assert.equal(
        dialog.openCodingPlanUpgrade(
          { providerId: "old-account" },
          { signal: new AbortController().signal, onResult: (value) => (opened = value) },
        ),
        false,
      );
      return createElement("span", null, "local-child");
    }
    assert.match(
      renderToString(
        createElement(ui.CodingPlanUpgradeDialogProvider, null, createElement(Consumer)),
      ),
      /local-child/,
    );
    assert.equal(opened, false);
  }
});
test("External provider authentication/quota errors remain verbatim and do not suggest closed sign-in/payment", () => {
  const capabilities = { productAccount: false, productSubscription: false };
  for (const [code, message] of [
    ["1006", "Provider rejected API key"],
    ["1005", "Provider quota exhausted"],
    ["3010", "Provider concurrency limit"],
  ]) {
    assert.equal(
      ui.resolveChatErrorBannerDisplayMessage({ code, message }, intl, capabilities),
      message,
    );
  }
  assert.equal(
    ui.resolveChatErrorBannerDisplayMessage({ code: "1006", message: "legacy" }, intl),
    "zcode.error.providerBusiness.1006",
  );
});
test("Unavailable historical account model renders actionable local settings rather than disappearing", () => {
  globalThis.__accountPlatform = {
    productCapabilities: { productAccount: false, productSubscription: false },
  };
  const html = renderToString(
    createElement(ui.ChatErrorBanner, {
      error: {
        code: "ZCODE_RUNTIME_MODEL_UNAVAILABLE",
        message: "The model used by this historical task is no longer available",
      },
      onOpenModelSettings() {},
    }),
  );
  assert.match(html, /settings.modelProvider.localConfigurationHint/);
  assert.match(html, /chat.error.setModels/);
  assert.doesNotMatch(html, /chat.quota.action.upgrade/);
});
