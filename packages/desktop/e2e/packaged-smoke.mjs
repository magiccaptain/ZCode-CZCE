import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_BACK_BUTTON,
  TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON,
  TID_MODEL_PROVIDER_TEMPLATE_ITEM,
  TID_MODEL_PROVIDER_API_KEY_INPUT,
  TID_PROJECT_ADD,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
  TID_V4_STOP,
  TID_V4_TIMELINE,
  testId,
} from "@zcode/shared";
import { waitFor } from "./runtime.mjs";

export async function runPackagedAgentSmoke({ app, page, runRoot, key }) {
  await page.getByTestId(TID_SETTINGS_BACK_BUTTON).click();
  await page.getByTestId(TID_TASK_SETTINGS_BUTTON).click();
  await page.getByTestId(testId(TID_SETTINGS_SECTION_NAV, "modelProvider")).click();
  await page.getByTestId(TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON).click();
  await page.getByTestId(testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, "deepseek")).click();
  const input = page.getByTestId(TID_MODEL_PROVIDER_API_KEY_INPUT);
  await input.fill(key);
  await input.press("Tab");
  await waitFor(
    async () =>
      (await readFile(join(runRoot, ".zcode/v2/provider_config.json"), "utf8")).includes(key),
    "packaged Provider credential saved",
  );
  await page.getByTestId(TID_SETTINGS_BACK_BUTTON).click();
  const workspace = join(runRoot, "workspace");
  await mkdir(workspace, { recursive: true });
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, workspace);
  await page.getByTestId(TID_PROJECT_ADD).click();
  await page.getByRole("menuitem", { name: "Open folder", exact: true }).click();
  await waitFor(
    async () =>
      (await page.getByTestId(TID_CHAT_MODEL_SELECT_TRIGGER).innerText()).includes(
        "deepseek-flash",
      ),
    "packaged local model selected",
  );
  const marker = `PACKAGED_AGENT_OK_${randomUUID().slice(0, 8)}`;
  await page
    .getByTestId(TID_V4_COMPOSER_INPUT)
    .fill(`Do not use tools. Reply with exactly ${marker}.`);
  await page.getByTestId(TID_V4_COMPOSER_SEND).click();
  await page
    .getByTestId(TID_V4_TIMELINE)
    .getByText(marker, { exact: true })
    .waitFor({ timeout: 120_000 });
  await page.getByTestId(TID_V4_STOP).waitFor({ state: "hidden", timeout: 120_000 });
  const sessionId = await page.locator("[data-session-id]").getAttribute("data-session-id");
  return { marker, sessionId, workspace, model: "deepseek-flash", actualDialogue: true };
}

export function inspectPackagedAgentSmoke(runRoot, result) {
  const db = new DatabaseSync(join(runRoot, "agent-storage/session.sqlite"), { readOnly: true });
  try {
    assert.equal(
      db.prepare("SELECT directory FROM session WHERE id=?").get(result.sessionId).directory,
      result.workspace,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM session_input WHERE session_id=? AND status='promoted'")
        .get(result.sessionId).n,
      1,
    );
    const rows = db
      .prepare(
        "SELECT json_extract(p.data,'$.text') AS text FROM part p JOIN message m ON m.id=p.message_id WHERE p.session_id=? AND json_extract(m.data,'$.role')='assistant' AND json_extract(p.data,'$.type')='text'",
      )
      .all(result.sessionId);
    assert.equal(rows.filter((row) => row.text.trim() === result.marker).length, 1);
    return { ...result, persistedOnce: true };
  } finally {
    db.close();
  }
}
