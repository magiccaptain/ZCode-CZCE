import { TID_TASK_NEW_BUTTON, TID_V4_STOP, TID_V4_TIMELINE } from "@zcode/shared";
import { waitFor } from "./runtime.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { respond } from "./mcp-fixture.mjs";

export async function prepareExtensions({ runRoot, workspace, marker }) {
  const stdioMarker = marker("MCP_STDIO");
  const httpMarker = marker("MCP_HTTP");
  const userMarker = marker("USER_SKILL");
  const projectMarker = marker("PROJECT_SKILL");
  const stdioRecord = join(runRoot, "stdio-calls.txt");
  const fixture = join(runRoot, "mcp-fixture.mjs");
  await copyFile(join(import.meta.dirname, "mcp-fixture.mjs"), fixture);
  for (const [base, name, value] of [
    [runRoot, "baseline-user-skill", userMarker],
    [workspace, "baseline-project-skill", projectMarker],
  ]) {
    const dir = join(base, ".zcode/skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: Local baseline verification skill, use only when requested\n---\nThe verification value is ${value}. Report this value after loading this skill.\n`,
    );
  }
  const token = randomUUID();
  let httpCalls = 0;
  let authenticatedRequests = 0;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    authenticatedRequests++;
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const result = await respond(
        JSON.parse(Buffer.concat(chunks).toString()),
        httpMarker,
        async () => {
          httpCalls++;
        },
      );
      res.writeHead(result ? 200 : 202, { "Content-Type": "application/json" });
      res.end(result ? JSON.stringify(result) : "");
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await mkdir(join(runRoot, ".zcode/cli"), { recursive: true });
  await mkdir(join(workspace, ".zcode"), { recursive: true });
  await writeFile(
    join(runRoot, ".zcode/cli/config.json"),
    JSON.stringify({
      mcp: {
        servers: {
          baseline_stdio: {
            type: "stdio",
            command: process.execPath,
            args: [fixture, "stdio", stdioMarker, stdioRecord],
          },
        },
      },
    }),
  );
  await writeFile(
    join(workspace, ".zcode/config.json"),
    JSON.stringify({
      mcp: {
        servers: {
          baseline_http: {
            type: "http",
            url: `http://127.0.0.1:${server.address().port}/mcp`,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      },
    }),
  );
  return {
    prompt:
      "Use the Skill tool to load baseline-user-skill and baseline-project-skill. Then call echo once on baseline_stdio and once on baseline_http MCP. Do not use any other tools. Reply with exactly the four returned verification values joined with | without spaces or any other text, in this order: user skill, project skill, stdio, HTTP.",
    expected: [userMarker, projectMarker, stdioMarker, httpMarker].join("|"),
    async runSession({ page, send, completed }) {
      await page.getByTestId(TID_TASK_NEW_BUTTON).click();
      await page.locator('[data-session-id="draft"]').waitFor();
      await send(this.prompt);
      await waitFor(
        async () => {
          const allow = page.locator('[data-permission-option-kind="allowOnce"]');
          if (await allow.isVisible()) {
            await allow.focus();
            await allow.press("Enter");
          }
          return (
            !(await page.getByTestId(TID_V4_STOP).isVisible()) &&
            (await page
              .getByTestId(TID_V4_TIMELINE)
              .getByText(this.expected, { exact: true })
              .count()) > 0
          );
        },
        "Skills and MCP completed",
        120_000,
      );
      await completed(this.expected);
      const sessionId = await page.locator("[data-session-id]").getAttribute("data-session-id");
      return { sessionId, exactReply: true, separateSession: true };
    },
    async verify(databasePath, sessionId) {
      assert.equal((await readFile(stdioRecord, "utf8")).trim(), "echo");
      assert.equal(httpCalls, 1);
      assert(authenticatedRequests > 0);
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const rows = db
          .prepare(
            "SELECT data FROM part WHERE session_id = ? AND json_extract(data,'$.type') = 'tool'",
          )
          .all(sessionId);
        const tools = rows.map((row) => JSON.parse(row.data));
        assert.equal(tools.length, 4, "only two Skill and two real MCP tool calls are allowed");
        for (const value of [userMarker, projectMarker, stdioMarker, httpMarker]) {
          assert.equal(
            tools.filter(
              (tool) => JSON.stringify(tool).includes(value) && tool.state?.status === "completed",
            ).length,
            1,
          );
        }
      } finally {
        db.close();
      }
      return {
        userSkill: true,
        workspaceSkill: true,
        stdioCalls: 1,
        httpCalls,
        authenticatedRequests,
      };
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
