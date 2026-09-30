import { access, appendFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// 测试工具用文件门闩让 runner 观察真实 busy 状态；120s 仅用于回收失败测试，
// 不把随机 sleep 当成运行中追加输入或停止成功的证据。
const [prefix, marker] = process.argv.slice(2);
if (!/^(busy|stop)$/.test(prefix) || !marker) throw new Error("Invalid fixture arguments");
await appendFile(`${prefix}-invocations.txt`, `${marker}\n`);
await writeFile(`${prefix}-started.txt`, marker);
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  const released = await access(`${prefix}-release.txt`).then(
    () => true,
    () => false,
  );
  if (released) {
    await writeFile(`${prefix}-completed.txt`, marker);
    process.stdout.write(`${marker}\n`);
    process.exit(0);
  }
  await delay(100);
}
throw new Error("Fixture release was not received");
