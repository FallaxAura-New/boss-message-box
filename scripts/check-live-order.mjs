import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5174";
const output = mkdtempSync("/private/tmp/nradio-live-order-");
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) });
const batch = { id: "00000000-0000-4000-8000-000000000007", startedAt: 1000, status: "active", archivedAt: null, revision: 0, count: 31 };
const items = Array.from({ length: 31 }, (_, i) => ({
  id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, batchId: batch.id,
  feedbackId: null, sourceType: "imported", filename: "排序测试数据.xlsx", importRowNumber: i + 2, importOrder: i + 2, addedAt: 1000,
  feedbackNumber: String(i + 1), userId: null, nickname: `排序测试观众${i + 1}`, topic: "appeal", customTopic: null,
  content: `测试留言 ${i + 1}：希望管理员可以按直播话题安排先后顺序。`, contentPreview: "排序测试留言", imageCount: 0, images: [],
  maskedPhone: null, shopPhone: null, createdAt: 1000, status: "unreplied", isTodo: false, replyCount: 0,
  latestReplyAdmin: null, replies: [], moderationStatus: "kept", liveSelected: true,
}));
let mode = "normal";
let activeReads = 0;
let neighborReads = 0;
const errors = [];
const mutations = [];
try {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/studio/**", route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const reply = json => route.fulfill({ json });
    if (path.endsWith("/session")) return reply({ ok: true, admin: { id: "fixture", username: "排序测试管理员" }, mode, expiresAt: Date.now() + 86400000 });
    if (path.endsWith("/live/active")) { activeReads++; return reply({ ok: true, batch }); }
    if (path.endsWith("/live/batches")) return reply({ ok: true, batches: [batch] });
    if (path.endsWith("/live/entries")) {
      const currentPage = Number(url.searchParams.get("page") ?? 1);
      return reply({ ok: true, batch, items: items.slice((currentPage - 1) * 30, currentPage * 30), total: items.length, page: currentPage, totalPages: 2 });
    }
    if (path.endsWith("/move")) {
      const payload = route.request().postDataJSON(); mutations.push(payload);
      assert.equal(payload.expectedRevision, batch.revision);
      const index = items.findIndex(item => item.id === path.split("/").at(-2));
      const [moved] = items.splice(index, 1); items.splice(payload.position - 1, 0, moved); batch.revision++;
      return reply({ ok: true });
    }
    if (path.includes("/live/entries/")) return reply({ ok: true, batchId: batch.id, item: items.find(item => item.id === path.split("/").at(-1)) });
    if (path.endsWith("/live/sequence")) {
      neighborReads++;
      const current = url.searchParams.get("currentId");
      const index = items.findIndex(item => item.id === current);
      const next = current ? items[index + (url.searchParams.get("direction") === "previous" ? -1 : 1)] : items[0];
      return reply({ ok: true, batchId: batch.id, feedbackId: next?.id ?? null, nextFeedbackId: next?.id ?? null });
    }
    if (path.endsWith("/stats")) return reply({ ok: true, todayFeedback: 0, unreplied: 0, todo: 0, todayReplied: 0 });
    if (path.endsWith("/new-feedback-count")) return reply({ ok: true, count: 0 });
    return route.fulfill({ status: 404, json: { ok: false, error: { message: `Unexpected fixture ${path}` } } });
  });
  const list = page.getByRole("list", { name: "直播展示顺序" });
  const form = nickname => page.getByRole("form", { name: `${nickname}的展示顺序` });
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${base}/studio/live-display`);
    await expect(list.getByRole("listitem")).toHaveCount(30);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px page overflow`);
    const targets = await page.locator(".studio-live-order input, .studio-live-order button").evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, right: rect.right };
    }));
    assert(targets.every(rect => rect.height >= 44 && rect.right <= width), `${width}px controls inaccessible`);
    await page.screenshot({ path: join(output, `order-${width}.png`) });
    console.log(`PASS ${width}px: single-column order, 44px targets, no overflow`);
  }
  const moveUp = form("排序测试观众3").getByRole("button", { name: "上移", exact: true });
  await moveUp.focus(); await page.keyboard.press("Enter");
  await expect(list.getByRole("heading").nth(1)).toHaveText("排序测试观众3");
  await expect(moveUp).toBeFocused();
  await page.reload();
  await expect(list.getByRole("heading").nth(1)).toHaveText("排序测试观众3");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  const position = page.getByRole("spinbutton", { name: "排序测试观众31的目标序号" });
  await position.fill("1"); await position.press("Enter");
  await expect(list.getByRole("heading").first()).toHaveText("排序测试观众31");
  await expect(page.getByRole("spinbutton", { name: "排序测试观众31的目标序号" })).toBeFocused();
  assert.equal(mutations.length, 2);
  // The pre-existing body min-width: 20rem clips 375px at 200% root text sizing.
  // Keep that legacy shell limitation explicit; verify scaled ordering at 768px.
  await page.setViewportSize({ width: 768, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  assert.equal(await page.evaluate(() => {
    const elements = [document.body, ...document.querySelectorAll(".studio-live-order input, .studio-live-order button")];
    return elements.some(element => element.getBoundingClientRect().right > innerWidth + 1);
  }), false, "200% text control clipping");
  await form("排序测试观众31").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "order-768-text-200.png") });
  console.log("PASS keyboard save/focus, persisted reload, cross-page movement, 200% text at 768px");

  // Simulate a second administrator changing the same batch while this screen is live.
  mode = "live";
  const current = items[0];
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/studio/feedback/${current.id}?mode=live&view=live_display&batch=${batch.id}`);
  await expect(page.locator(".studio-live-message-text > p")).toHaveText(current.content);
  await expect.poll(() => activeReads).toBeGreaterThan(0);
  // Wait until the original neighbour is prefetched, then change it.
  await expect.poll(() => neighborReads).toBeGreaterThanOrEqual(2);
  const next = items.splice(3, 1)[0]; items.splice(1, 0, next); batch.revision++;
  const readsBefore = activeReads;
  await expect.poll(() => activeReads, { timeout: 7000 }).toBeGreaterThan(readsBefore);
  await expect(page.locator(".studio-live-message-text > p")).toHaveText(current.content);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".studio-live-message-text > p")).toHaveText(next.content);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".studio-live-message-text > p")).toHaveText(current.content);
  console.log("PASS live revision refresh and forward/backward custom sequence");
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
  await context.close();
} finally { await browser.close(); }
