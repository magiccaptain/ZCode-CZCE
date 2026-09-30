import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";

/** 最小本地 MCP fixture；协议输入和工具执行均由真实 Agent transport 处理。 */
export async function respond(request, marker, record) {
  if (request.id === undefined) return null;
  let result;
  switch (request.method) {
    case "initialize":
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "baseline-fixture", version: "1.0.0" },
      };
      break;
    case "tools/list":
      result = {
        tools: [
          {
            name: "echo",
            description: "Return the verification marker",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
      };
      break;
    case "tools/call":
      await record(request.params.name);
      result = { content: [{ type: "text", text: marker }] };
      break;
    case "ping":
      result = {};
      break;
    default:
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "Method not found" },
      };
  }
  return { jsonrpc: "2.0", id: request.id, result };
}

if (process.argv[2] === "stdio") {
  const [, , , marker, recordPath] = process.argv;
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    const result = await respond(JSON.parse(line), marker, (name) =>
      appendFile(recordPath, `${name}\n`),
    );
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
