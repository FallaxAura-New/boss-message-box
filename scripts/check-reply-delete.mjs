import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

const output = mkdtempSync("/private/tmp/nradio-reply-delete-");
const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5174";
const scaled = process.env.VISUAL_TEXT_SCALE === "200";
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) });
const id = "10000000-0000-4000-8000-000000000001";
const item = {
  id, feedbackNumber: "10000000", userId: null, nickname: "删除功能测试观众", topic: "appeal", customTopic: null,
  content: "这是一条用于本地验证的模拟留言，删除回复后原始留言应保持不变。", contentPreview: "本地模拟留言", imageCount: 0, images: [],
  maskedPhone: null, shopPhone: null, createdAt: Date.UTC(2026, 8, 12, 15, 33), status: "replied", isTodo: false,
  replyCount: 2, latestReplyAdmin: "测试管理员", moderationStatus: "kept", routingStatus: "selected",
  replies: ["你好", "这是第二次回复。较长的回复内容应当正常换行，不遮挡右侧的删除按钮。"].map((content, index) => ({
    id: `reply-${index}`, content, replyType: "message", adminUsername: "测试管理员", createdAt: Date.UTC(2026, 8, 12, 15, 34),
  })),
};
const errors = [];
let deletes = 0;
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/studio/**", route => {
    const path = new URL(route.request().url()).pathname;
    const reply = json => route.fulfill({ json });
    if (path.endsWith("/session")) return reply({ ok: true, admin: { id: "fixture", username: "测试管理员" }, mode: "normal", expiresAt: Date.now() + 86400000 });
    if (path.endsWith("/stats")) return reply({ ok: true, todayFeedback: 1, unreplied: 0, todo: 0, todayReplied: 1 });
    if (path.endsWith("/new-feedback-count")) return reply({ ok: true, count: 0 });
    if (route.request().method() === "DELETE") {
      deletes++;
      if (deletes === 1) return route.fulfill({ status: 500, json: { error: { message: "模拟删除失败，请重试" } } });
      item.replies = item.replies.filter(reply => reply.id !== path.split("/").at(-1));
      item.replyCount = item.replies.length;
      item.status = item.replyCount ? "replied" : "unreplied";
      return reply({ ok: true, item });
    }
    if (path.endsWith(`/feedbacks/${id}`)) return reply({ ok: true, item });
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected fixture: ${path}` } } });
  });
  for (const width of scaled ? [768] : [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${base}/studio/feedback/${id}`);
    const history = page.locator("section[aria-labelledby=studio-replies-title]");
    await expect(history.getByRole("listitem")).toHaveCount(2);
    if (scaled) await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await history.scrollIntoViewIfNeeded();
    const geometry = await page.locator(".studio-reply-meta").evaluateAll(elements => elements.map(element => {
      const time = element.querySelector("time").getBoundingClientRect();
      const button = element.querySelector("button").getBoundingClientRect();
      return { below: button.top >= time.bottom, right: button.right, height: button.height };
    }));
    assert(geometry.every(rect => rect.below && rect.right <= width && rect.height >= 44));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(output, `history-${width}.png`) });
    const remove = page.getByRole("button", { name: "删除第 1 条回复" });
    await remove.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "删除这条回复？" })).toBeVisible();
    await page.screenshot({ path: join(output, `confirm-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(remove).toBeFocused();
    assert.equal(deletes, 0);
    console.log(`PASS ${width}px: below timestamp, accessible targets, keyboard cancel, no overflow`);
  }
  const draft = page.getByRole("textbox", { name: "回复内容" });
  await draft.fill("未提交草稿必须保留");
  await page.getByRole("button", { name: "删除第 1 条回复" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("alert")).toHaveText("模拟删除失败，请重试");
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.locator(".studio-reply-history li")).toHaveCount(1);
  await expect(page.locator("#studio-replies-title")).toBeFocused();
  await expect(draft).toHaveValue("未提交草稿必须保留");
  await page.getByRole("button", { name: "删除第 1 条回复" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("还没有回复。")).toBeVisible();
  await expect(page.getByText(item.content, { exact: true })).toBeVisible();
  await expect(draft).toHaveValue("未提交草稿必须保留");
  await page.reload();
  await expect(page.getByText("还没有回复。")).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(`PASS delete retry, last reply, draft preservation, persisted reload. Screenshots: ${output}`);
} finally { await browser.close(); }
