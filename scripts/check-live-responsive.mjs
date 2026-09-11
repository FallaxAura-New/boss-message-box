import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const output = mkdtempSync("/private/tmp/nradio-responsive-");
const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5174";
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) });
const batch = { id: "00000000-0000-4000-8000-000000000007", startedAt: 1000, status: "active", archivedAt: null, revision: 0, count: 1 };
const jobId = "22222222-2222-4222-8222-222222222222";
const id = "11111111-1111-4111-8111-111111111111";
const paragraph = "最初，我以公测用户的身份体验设备，带着好奇与期待深度使用，感受产品的性能优势，同时也如实反馈使用中的细节问题。体验过后，出于对产品实力的认可，我继续优化配件与网络配置，希望下一次直播介绍不同场景下的实际表现。";
let scenario = { content: `${paragraph}\n\n`.repeat(10).trim(), images: 3, nickname: "测试观众", topic: "实际体验与建议" };
let mode = "live";
const results = [];
const errors = [];
const writes = [];
const item = () => ({ id, batchId: batch.id, feedbackId: null, sourceType: "imported", filename: "直播留言测试.xlsx", importRowNumber: 2, importOrder: 2, addedAt: 1000,
  feedbackNumber: "11111111", userId: null, nickname: scenario.nickname, topic: "other", customTopic: scenario.topic, content: scenario.content, contentPreview: scenario.content.slice(0, 240),
  imageCount: scenario.images, images: Array.from({ length: scenario.images }, (_, i) => ({ id: `image-${i}`, viewUrl: `/fixture-${i}.svg`, downloadUrl: `/fixture-${i}.svg`, width: i ? 800 : 360, height: i ? 450 : 640 })),
  maskedPhone: null, shopPhone: null, createdAt: 1000, status: "unreplied", isTodo: false, replyCount: 0, latestReplyAdmin: null, replies: [], moderationStatus: "kept", liveSelected: true });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/fixture-*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><rect width="360" height="640" fill="#152c41"/><circle cx="180" cy="250" r="110" fill="#4edfff"/><text x="180" y="530" text-anchor="middle" fill="#f3f8fd" font-size="32">TEST IMAGE</text></svg>' }));
  await page.route("**/api/studio/**", route => {
    const path = new URL(route.request().url()).pathname;
    const reply = json => route.fulfill({ json });
    if (route.request().method() !== "GET") writes.push(path);
    if (path.endsWith("/session/mode")) mode = route.request().postDataJSON().mode;
    if (path.endsWith("/session") || path.endsWith("/session/mode")) return reply({ ok: true, admin: { id: "fixture", username: "测试管理员" }, mode, expiresAt: Date.now() + 86400000 });
    if (path.endsWith("/live/active")) return reply({ ok: true, batch });
    if (path.endsWith("/live/batches")) return reply({ ok: true, batches: [batch] });
    if (path.endsWith("/live/entries")) return reply({ ok: true, batch, items: [item()], total: 1, page: 1, totalPages: 1 });
    if (path.endsWith(`/live/entries/${id}`)) return reply({ ok: true, item: item(), batchId: batch.id });
    if (path.endsWith("/live/sequence")) return reply({ ok: true, batchId: batch.id, feedbackId: id, nextFeedbackId: null });
    if (path.endsWith(`/imports/${jobId}`)) return reply({ ok: true, job: { id: jobId, batchId: batch.id, filename: item().filename, createdAt: 1000, rows: [{ rowNumber: 2, nickname: scenario.nickname, content: scenario.content, topic: "other", customTopic: scenario.topic, status: "imported", routingStatus: "pending" }] } });
    if (path.endsWith("/stats")) return reply({ ok: true, todayFeedback: 0, unreplied: 0, todo: 0, todayReplied: 0 });
    if (path.endsWith("/new-feedback-count")) return reply({ ok: true, count: 0 });
    return route.fulfill({ status: 404, json: { ok: false, error: { message: `Unexpected fixture request ${path}` } } });
  });
  const metrics = () => page.evaluate(() => {
    const region = document.querySelector(".studio-live-message-text");
    const text = region.querySelector("p");
    const media = document.querySelector(".studio-live-images");
    const bounds = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
    return { width: innerWidth, height: innerHeight, region: bounds(region), text: bounds(text), media: media && bounds(media), stage: bounds(document.querySelector(".studio-live-stage")),
      font: parseFloat(getComputedStyle(text).fontSize), rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize), scrollHeight: region.scrollHeight, clientHeight: region.clientHeight,
      pageOverflow: document.documentElement.scrollWidth > innerWidth, textOverflow: region.scrollWidth > region.clientWidth + 1 };
  });
  const check = async label => {
    await expect(page.locator(".studio-live-message-text > p")).toHaveText(scenario.content);
    await page.waitForTimeout(150);
    const m = await metrics();
    assert(!m.pageOverflow && !m.textOverflow, `${label}: horizontal overflow`);
    assert(m.font >= 16, `${label}: unreadable font ${m.font}`);
    const minFont = Math.max(m.rootFont, Math.min(m.width * 0.013, m.rootFont * 1.5));
    assert(m.scrollHeight <= m.clientHeight + 1 || m.font <= minFont + 0.25, `${label}: scrollable text has not shrunk to its readable floor`);
    assert(m.text.width >= m.region.width - 18, `${label}: unused text column width`);
    assert(m.region.bottom <= m.height + 1 && m.region.height >= 80, `${label}: text region inaccessible`);
    if (m.media) {
      assert(m.media.bottom <= m.height + 1, `${label}: images clipped`);
      if (m.width <= 640 && m.height >= 512) assert(m.media.y >= m.region.bottom, `${label}: phone text squeezed by images`);
      else assert(m.media.x >= m.region.right, `${label}: side images overlap text`);
    }
    const scroll = page.locator(".studio-live-message-text");
    await scroll.evaluate(el => { el.scrollTop = 0; });
    assert(await scroll.evaluate(el => el.querySelector("p").getBoundingClientRect().top >= el.getBoundingClientRect().top - 1), `${label}: first line inaccessible`);
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert(await scroll.evaluate(el => el.querySelector("p").getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1), `${label}: final line inaccessible`);
    await scroll.evaluate(el => { el.scrollTop = 0; });
    const identity = page.getByRole("region", { name: "昵称与主题" });
    await identity.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert(await identity.evaluate(el => el.querySelector(".studio-live-identity-copy > p").getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1), `${label}: topic inaccessible`);
    await identity.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: join(output, `${label}.png`) });
    results.push({ label, ...m });
    console.log(`PASS ${label}: font=${m.font.toFixed(2)}px, body=${Math.round(m.text.width)}px, scroll=${m.scrollHeight > m.clientHeight}`);
    return m;
  };
  await page.goto(`${base}/studio/feedback/${id}?mode=live&view=live_display&batch=${batch.id}`);
  for (const [width, height] of [[1920,1080], [2654,1498], [1280,700], [768,800], [375,700], [844,390], [1920,1080]]) {
    await page.setViewportSize({ width, height });
    await check(`long-${width}x${height}`);
  }
  await page.getByRole("button", { name: "放大留言图片 1" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭图片" }).click();
  scenario = { content: "希望下一次直播介绍不同环境中的产品体验。", images: 0, nickname: "短文测试观众", topic: "实际体验" };
  await page.reload();
  const large = await check("short-1920x1080");
  await page.setViewportSize({ width: 375, height: 700 });
  const small = await check("short-375x700");
  assert(large.font > small.font + 10, "font did not respond to viewport resizing");
  scenario = { content: `开头\n${"中英文Mixed_".repeat(190)}\n结尾`, images: 3, nickname: "用于验证最长昵称在较窄的窗口依然可读且不会挤出全部正文的测试观众", topic: "用于检查较长自定义主题在小窗口的展示效果" };
  await page.reload();
  await check("mixed-long-name-375x700");
  await page.setViewportSize({ width: 844, height: 390 });
  await check("mixed-long-name-844x390");
  // Simulate larger default text: the fit floor must follow rem rather than undo text scaling.
  await page.setViewportSize({ width: 640, height: 700 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const scaled = await check("text-scale-200");
  assert(scaled.font >= 32, "fit algorithm defeated 200% text scaling");
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  mode = "normal";
  scenario = { content: `${paragraph}\n\n`.repeat(14).trim(), images: 0, nickname: "导入详情测试观众", topic: "实际体验与建议" };
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${base}/studio/live-display?batch=${batch.id}&page=1`);
    await page.getByRole("link", { name: "查看留言详情" }).click();
    await expect(page.locator(".studio-detail-content")).toHaveText(scenario.content);
    await page.reload();
    await expect(page.locator(".studio-detail-content")).toHaveText(scenario.content);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "detail horizontal overflow");
    await page.screenshot({ path: join(output, `import-detail-${width}.png`), fullPage: true });
    await page.getByRole("link", { name: "返回列表" }).click();
    await expect(page.getByRole("heading", { name: "直播展示", exact: true })).toBeVisible();
    await page.goto(`${base}/studio/imports/${jobId}/rows/2`);
    await expect(page.locator(".studio-detail-content")).toHaveText(scenario.content);
    await expect(page.getByText(/Excel 导入 · 待分流/)).toBeVisible();
    console.log(`PASS imported detail ${width}: list link, reload, return, source row`);
  }
  assert(writes.every(path => path.endsWith("/session/mode")), "detail unexpectedly mutated data");
  assert.deepEqual(errors, []);
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(`Screenshots and measurements: ${output}`);
  await context.close();
} finally { await browser.close(); }
