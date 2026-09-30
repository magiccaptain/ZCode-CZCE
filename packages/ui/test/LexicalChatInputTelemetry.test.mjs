import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from "lexical";

const require = createRequire(new URL("../../desktop/package.json", import.meta.url));
const ts = require("typescript");
const buildRequire = createRequire(require.resolve("tsup"));
const { build } = await import(pathToFileURL(buildRequire.resolve("esbuild")).href);
const source = ts.createSourceFile(
  "LexicalChatInput.tsx",
  await readFile(new URL("../src/LexicalChatInput.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
// 执行真实内部插件及序列化入口，不为测试增加产品导出或复制 update callback。
const declarations = ["TextContentPlugin", "getEditorMarkdown"].map((name) => {
  const declaration = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert(declaration, name);
  return declaration.getText(source);
});
const outfile = join(import.meta.dirname, "../../desktop/.e2e-cache/lexical-input-telemetry.mjs");
await mkdir(join(import.meta.dirname, "../../desktop/.e2e-cache"), { recursive: true });
await build({
  stdin: {
    contents: `import { $getPromptMarkdown } from '../src/mentions/promptSerialization.ts';
      import { PROGRAMMATIC_UPDATE_TAG } from '../src/lib/editorUpdateTags.ts';
      const {useEffect,useRef,useLexicalComposerContext,useOptionalPlatform,performance,recordInputLag} = globalThis.__lexicalTelemetryPorts;
      ${declarations.join("\n")}
      export { TextContentPlugin };`,
    resolveDir: import.meta.dirname,
    loader: "tsx",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  loader: { ".png": "dataurl" },
});

for (const enabled of [false, true]) {
  test(`TextContentPlugin telemetry=${enabled}: real text updates survive collection guard`, async () => {
    const effects = [];
    const events = new Map();
    let rootRegistrations = 0;
    let clockReads = 0;
    const samples = [];
    const changes = [];
    const editor = createEditor({
      namespace: "telemetry-test",
      onError: (error) => {
        throw error;
      },
    });
    const root = {
      addEventListener: (name, handler) => events.set(name, handler),
      removeEventListener: (name, handler) => {
        if (events.get(name) === handler) events.delete(name);
      },
    };
    // DOM port only: update listener and EditorState serialization are real Lexical.
    editor.registerRootListener = (callback) => {
      rootRegistrations++;
      callback(root, null);
      return () => callback(null, root);
    };
    globalThis.__lexicalTelemetryPorts = {
      useEffect: (effect) => effects.push(effect),
      useRef: (current) => ({ current }),
      useLexicalComposerContext: () => [editor],
      useOptionalPlatform: () => ({ productCapabilities: { telemetry: enabled } }),
      performance: {
        now: () => {
          clockReads++;
          return clockReads * 100;
        },
      },
      recordInputLag: (sample) => samples.push(sample),
    };
    const { TextContentPlugin } = await import(`${pathToFileURL(outfile).href}?enabled=${enabled}`);
    TextContentPlugin({ onChange: (text) => changes.push(text), taskId: "fixture" });
    const cleanups = effects.map((effect) => effect());
    try {
      assert.equal(
        rootRegistrations,
        enabled ? 1 : 0,
        "no telemetry composition listener when disabled",
      );
      assert.equal(events.size, enabled ? 2 : 0);
      for (const text of ["a", "first character and 后续文本"]) {
        editor.update(
          () => {
            $getRoot()
              .clear()
              .append($createParagraphNode().append($createTextNode(text)));
          },
          { discrete: true },
        );
      }
      assert.deepEqual(changes, ["a", "first character and 后续文本"]);
      assert.equal(clockReads, enabled ? 4 : 0, "disabled callback must not read the timing clock");
      assert.equal(samples.length, enabled ? 2 : 0, "disabled callback must not construct samples");
      if (enabled) assert.equal(samples[1].taskId, "fixture");
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append($createParagraphNode().append($createTextNode(changes.at(-1))));
        },
        { discrete: true },
      );
      assert.equal(changes.length, 2, "unchanged markdown does not emit onChange twice");
    } finally {
      for (const cleanup of cleanups) cleanup?.();
      assert.equal(events.size, 0, "telemetry composition listeners are cleaned up");
      delete globalThis.__lexicalTelemetryPorts;
    }
  });
}
