import { expect, test } from "@playwright/test";

const run = async (page: any, key: string, block: number) => {
  await page.evaluate((b: number) => {
    const ed = (window as any).__editor;
    ed.focus();
    ed.setSelection({ anchor: { block: b, offset: 1 }, focus: { block: b, offset: 1 } });
  }, block);
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
  return page.evaluate(() => (window as any).__editor.getMarkdown());
};

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/hotkeys-probe.html");
  await page.waitForFunction(() => !!(window as any).__editor);
});

test("alt+down moves item down", async ({ page }) => {
  expect(await run(page, "Alt+ArrowDown", 1)).toBe("- one\n- three\n- two");
});

test("alt+up moves item up", async ({ page }) => {
  expect(await run(page, "Alt+ArrowUp", 1)).toBe("- two\n- one\n- three");
});

test("ctrl+y still cycles task (control path works)", async ({ page }) => {
  const md = await run(page, "Control+y", 1);
  console.log("CTRL+Y:", JSON.stringify(md));
  expect(md).not.toBe("- one\n- two\n- three");
});
