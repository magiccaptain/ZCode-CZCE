import assert from "node:assert/strict";
import { TID_V4_COMPOSER_INPUT } from "@zcode/shared";

export async function checkPreferences(page, mode, memory = mode === "office", suggestions = true) {
  const onboarding = page.getByTestId("onboarding-page");
  const checkboxes = onboarding.getByRole("checkbox");
  await checkboxes.first().waitFor();
  assert.equal(await checkboxes.count(), mode === "office" ? 2 : 1);
  const labels = await onboarding.locator("label .font-medium").allTextContents();
  if (mode === "office") {
    assert.match(labels[0], /^(开启主动任务推荐|Enable proactive task suggestions)$/);
    assert.equal(await checkboxes.nth(0).getAttribute("aria-checked"), String(suggestions));
  }
  assert.match(labels.at(-1), /^(开启工作区记忆|Enable Workspace Memory)$/);
  assert.equal(await checkboxes.last().getAttribute("aria-checked"), String(memory));
  assert.doesNotMatch(
    await onboarding.innerText(),
    /迁移会话数据|Migrate conversations|Claude Code/,
  );
  return checkboxes;
}

export async function checkNoMigrationDialog(page) {
  await page.getByTestId(TID_V4_COMPOSER_INPUT).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
}

export async function finishOnboarding(page, mode, screenshot) {
  const onboarding = page.getByTestId("onboarding-page");
  await onboarding.getByRole("button", { name: /^(下一步|Next)$/ }).click();
  const checkboxes = await checkPreferences(page, mode);
  await page.screenshot({ path: screenshot });
  if (mode === "office") {
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();
    await checkPreferences(page, mode, false, false);
  }
  await onboarding.getByRole("button", { name: /^(开始使用|Get started)$/ }).click();
  await checkNoMigrationDialog(page);
}
