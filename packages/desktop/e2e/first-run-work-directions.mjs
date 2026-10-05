import assert from "node:assert/strict";

const titles = {
  "zh-CN": [
    "综合办公与行政",
    "研究分析与品种研发",
    "市场推广与产业服务",
    "会员管理与业务支持",
    "交易与结算业务",
    "交割与仓储管理",
    "风险管理与市场监察",
    "法律合规与审计监督",
    "信息技术与数据支持",
    "财务与采购管理",
    "党务与组织人事",
    "其他工作",
  ],
  "en-US": [
    "Administration & Office Work",
    "Research & Product Development",
    "Marketing & Industry Services",
    "Member Management & Support",
    "Trading & Settlement",
    "Delivery & Warehousing",
    "Risk Management & Market Surveillance",
    "Legal, Compliance & Audit",
    "IT & Data Support",
    "Finance & Procurement",
    "Party Affairs & Human Resources",
    "Other Work",
  ],
};
const descriptions = [
  "公文起草、会议纪要、汇报材料、工作督办",
  "产业研究、市场分析、品种资料、研究报告",
  "企业调研、业务宣介、培训材料、活动策划",
  "会员材料整理、业务答疑、通知编写、服务记录",
  "交易统计、结算核对、资金报表、业务流程查阅",
  "交割资料、仓单数据、仓储信息、流程核对",
  "风险数据分析、异常线索整理、监测报告",
  "法规检索、条款对照、制度检查、审计材料",
  "开发运维、日志排查、数据处理、自动化脚本",
  "预算统计、费用汇总、采购材料、财务报表",
  "党务材料、人事信息整理、培训计划、组织工作",
  "通用问答、材料整理及其他任务",
];

export async function checkWorkDirections(page, locale, selectedIndex = null) {
  const onboarding = page.getByTestId("onboarding-page");
  const choices = onboarding.locator("button[aria-pressed]");
  await choices.first().waitFor();
  assert.equal(await choices.count(), 12);
  for (const [index, title] of titles[locale].entries()) {
    const lines = (await choices.nth(index).innerText()).split("\n").filter(Boolean);
    assert.equal(lines[0], title);
    assert.ok(lines[1]?.trim(), `${title}: missing task description`);
    if (locale === "zh-CN") assert.equal(lines[1], descriptions[index]);
    assert.equal(
      await choices.nth(index).getAttribute("aria-pressed"),
      String(index === selectedIndex),
    );
  }
  assert.equal(
    await onboarding.getByRole("button", { name: /^(下一步|Next)$/ }).isEnabled(),
    selectedIndex !== null,
  );
  assert.equal(await onboarding.getByRole("button", { name: /^(跳过|Skip)$/ }).isEnabled(), true);
  return choices;
}

export async function checkWorkDirectionLayout(page, columns) {
  const choices = page.getByTestId("onboarding-page").locator("button[aria-pressed]");
  const boxes = await choices.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  for (let index = 0; index < boxes.length; index += columns) {
    if (columns === 2) {
      assert.ok(Math.abs(boxes[index].y - boxes[index + 1].y) < 1);
      assert.ok(boxes[index].x + boxes[index].width < boxes[index + 1].x);
    }
    if (index >= columns)
      assert.ok(boxes[index].y >= boxes[index - columns].y + boxes[index - columns].height);
  }
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  for (let index = 0; index < 12; index++) {
    await choices.nth(index).scrollIntoViewIfNeeded();
    assert.equal(await choices.nth(index).isVisible(), true);
  }
  await choices.first().scrollIntoViewIfNeeded();
}

export async function selectWorkDirection(page, index) {
  const onboarding = page.getByTestId("onboarding-page");
  await onboarding.locator("button[aria-pressed]").nth(index).click();
  assert.equal(await onboarding.getByRole("button", { name: /^(下一步|Next)$/ }).isEnabled(), true);
}

export async function skipWorkDirection(page) {
  await page
    .getByTestId("onboarding-page")
    .getByRole("button", { name: /^(跳过|Skip)$/ })
    .click();
}
