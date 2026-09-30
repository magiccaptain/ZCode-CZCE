import assert from "node:assert/strict";
import { TID_V4_COMPOSER_INPUT } from "@zcode/shared";

/** 实际禁用平台上的输入/序列化回归，不发送模型请求。采集时钟/监听由源插件单测断言。 */
export async function assertDisabledTelemetryInput(page) {
  const input = page.getByTestId(TID_V4_COMPOSER_INPUT);
  for (const text of ["a", "telemetry disabled 后续输入", ""]) {
    await input.fill(text);
    assert.equal(await input.evaluate((element) => element.__zcodeLexicalInputE2E.getText()), text);
  }
  assert.equal(await page.evaluate(() => Boolean(window.__zcodeArmsCustomEventsE2E)), false);
}
