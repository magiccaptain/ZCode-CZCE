import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

/** 测试只读临时库；不能用持久化注入代替 UI admission 或恢复。 */
export function inspectPersistence({ databasePath, sessionId, token, workspace }) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const session = db.prepare("SELECT directory FROM session WHERE id=?").get(sessionId);
    assert.equal(session.directory, workspace);
    const inputs = db
      .prepare(
        "SELECT id, payload, delivery, admitted_sequence, promoted_sequence, status FROM session_input WHERE session_id=? ORDER BY admitted_sequence",
      )
      .all(sessionId);
    assert.equal(inputs.length, 9);
    assert.equal(new Set(inputs.map((input) => input.id)).size, 9);
    for (const [index, input] of inputs.entries()) {
      assert.equal(input.admitted_sequence, index);
      assert.equal(input.promoted_sequence, index);
      assert.equal(input.status, "promoted");
    }
    const queued = inputs.filter((input) => input.delivery === "queue");
    assert.equal(queued.length, 1);
    assert(JSON.parse(queued[0].payload).text.includes(`BASELINE_FOLLOWUP_${token}`));

    const tools = db
      .prepare(
        "SELECT data FROM part WHERE session_id=? AND json_extract(data,'$.type')='tool' ORDER BY sequence",
      )
      .all(sessionId)
      .map((row) => JSON.parse(row.data));
    const matching = (text) => tools.filter((part) => part.state.input.command?.includes(text));
    const completedOnce = (text) => {
      const matches = matching(text);
      assert.equal(matches.length, 1, `Duplicate or missing tool: ${text}`);
      assert.equal(matches[0].state.status, "completed");
      return matches[0];
    };
    const tool = completedOnce("tool-result.txt");
    assert(tool.state.output.includes(`BASELINE_TOOL_${token}`));
    assert.deepEqual(
      matching("permission-result.txt").map((part) => part.state.status),
      ["error", "completed"],
    );
    completedOnce("gated-tool.mjs busy");
    completedOnce("followup-result.txt");
    const stopped = matching("gated-tool.mjs stop");
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0].state.status, "error");

    const replies = db
      .prepare(
        "SELECT json_extract(p.data,'$.text') AS text FROM part p JOIN message m ON m.id=p.message_id WHERE m.session_id=? AND json_extract(m.data,'$.role')='assistant' AND json_extract(p.data,'$.type')='text'",
      )
      .all(sessionId)
      .map((row) => row.text.trim());
    for (const name of [
      "HELLO",
      "TOOL_DONE",
      "DENIED",
      "ALLOWED",
      "FOLLOWUP_DONE",
      "AFTER_STOP",
      "RECOVERED",
    ]) {
      assert.equal(replies.filter((text) => text === `BASELINE_${name}_${token}`).length, 1);
    }
    assert(!replies.includes(`BASELINE_STOP_DONE_${token}`));
    return {
      sessionDirectory: workspace,
      admittedInputs: inputs.length,
      uniqueInputs: true,
      serialPromotion: true,
      queuedInputs: queued.length,
      toolStatuses: tools.map((part) => ({ tool: part.tool, status: part.state.status })),
      toolOutputRestored: true,
      stoppedToolCompleted: false,
      expectedRepliesPersistedOnce: true,
    };
  } finally {
    db.close();
  }
}
