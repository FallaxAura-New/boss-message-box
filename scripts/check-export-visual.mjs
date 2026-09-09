import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const id = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const item = { id, feedbackNumber: "11111111", userId: null, nickname: "导出测试鹏友", topic: "appeal", customTopic: null, content: "完整留言正文\n第二行应完整保留。", contentPreview: "完整留言正文", imageCount: 0, images: [], shopPhone: "+853 0012-3456", maskedPhone: null, createdAt: 1000, status: "unreplied", isTodo: false, replyCount: 0, latestReplyAdmin: null, replies: [], moderationStatus: "kept", moderationCategory: "valid_feedback", moderationReason: null };
async function bytes(download) {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}
try {
  for (const viewport of [{ width: 375, height: 700 }, { width: 768, height: 800 }, { width: 1280, height: 700 }]) {
    if (process.argv[2] && viewport.width !== Number(process.argv[2])) continue;
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    let mode = "normal";
    let exportState = "ready";
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://challenges.cloudflare.com/**", route => route.fulfill({ contentType: "application/javascript", body: "window.turnstile={render:()=>1,execute:()=>{},reset:()=>{},remove:()=>{}};" }));
    await page.route("**/api/config", route => route.fulfill({ json: { turnstileSiteKey: "1x00000000000000000000AA", privacyPolicyVersion: "v1", livestreamPolicyVersion: "v1" } }));
    await page.route("**/api/studio/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/session/mode")) mode = route.request().postDataJSON().mode;
      if (path.endsWith("/session") || path.endsWith("/session/mode")) return route.fulfill({ json: { ok: true, admin: { id: "test", username: "测试管理员" }, mode, expiresAt: Date.now() + 86400000 } });
      if (path.endsWith("/stats")) return route.fulfill({ json: { ok: true, todayFeedback: 2, unreplied: 2, todo: 0, todayReplied: 0 } });
      if (path.endsWith("/new-feedback-count")) return route.fulfill({ json: { ok: true, count: 0 } });
      if (path.endsWith("/feedbacks")) return route.fulfill({ json: { ok: true, items: [item], pagination: { page: 1, pageSize: 30, total: 2, totalPages: 1 }, snapshot: { createdAt: 1000, id } } });
      if (path.endsWith(`/feedbacks/${id}`)) return route.fulfill({ json: { ok: true, item } });
      if (path.endsWith("/export")) {
        const input = route.request().postDataJSON(); requests.push(input);
        if (exportState === "error") return route.fulfill({ status: 500, json: { ok: false, error: { message: "导出测试错误，请重试" } } });
        if (exportState === "empty") return route.fulfill({ json: { ok: true, items: [], snapshot: null, nextCursor: null } });
        if (exportState === "pending") return;
        return route.fulfill({ json: { ok: true, items: input.before ? [{ ...item, id: secondId, shopPhone: "001234" }] : [item], snapshot: { createdAt: 1000, id }, nextCursor: input.before ? null : { createdAt: 900, id: secondId } } });
      }
      return route.fulfill({ status: 404, json: { ok: false } });
    });
    await page.goto("http://127.0.0.1:5173/");
    const phone = page.getByRole("textbox", { name: "张导小店绑定手机号", exact: true });
    await phone.fill("+853 0012-3456");
    await page.waitForFunction(() => localStorage.getItem("boss-message-box:draft:v1")?.includes("+853 0012-3456"));
    await page.reload();
    await phone.waitFor();
    assert.equal(await phone.inputValue(), "+853 0012-3456");
    await phone.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/private/tmp/boss-phone-${viewport.width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto("http://127.0.0.1:5173/studio/unreplied?topic=appeal");
    await page.getByRole("button", { name: "导出留言", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导出留言", exact: true });
    await dialog.waitFor();
    await page.screenshot({ path: `/private/tmp/boss-export-${viewport.width}.png` });
    const box = await dialog.boundingBox();
    assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, "export dialog clipped");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const xlsxPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "开始导出" }).click();
    const xlsx = await xlsxPromise;
    assert.match(xlsx.suggestedFilename(), /\.xlsx$/);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await bytes(xlsx));
    assert.equal(workbook.getWorksheet("留言").rowCount, 3);
    assert.equal(workbook.getWorksheet("留言").getCell("D2").value, item.shopPhone);
    assert.equal(workbook.getWorksheet("留言").getCell("D3").value, "001234");
    assert.equal(requests[0].topic, "appeal");
    assert.equal(requests[1].before.id, secondId);
    await dialog.getByText(/已生成 2 条留言/).waitFor();
    await dialog.getByLabel("文件格式").selectOption("md");
    await dialog.getByLabel("导出范围").selectOption("all");
    const mdPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "开始导出" }).click();
    const md = await mdPromise;
    assert.match(md.suggestedFilename(), /\.md$/);
    assert.match((await bytes(md)).toString(), /第二行应完整保留/);
    assert.equal(requests[2].view, "all"); assert.equal(requests[2].topic, null);
    await dialog.getByText(/已生成 2 条留言/).waitFor();
    if (viewport.width === 375) {
      exportState = "error";
      await dialog.getByRole("button", { name: "开始导出" }).click();
      await dialog.getByRole("alert").waitFor();
      exportState = "empty";
      await dialog.getByRole("button", { name: "开始导出" }).click();
      await dialog.getByText(/这个范围没有留言/).waitFor();
      exportState = "pending";
      await dialog.getByRole("button", { name: "开始导出" }).click();
      await dialog.getByRole("button", { name: "取消导出" }).click();
    } else await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "导出留言", exact: true }).evaluate(el => document.activeElement === el), true);
    await page.goto(`http://127.0.0.1:5173/studio/feedback/${id}`);
    await page.getByText(item.shopPhone, { exact: true }).waitFor();
    await page.locator(".studio-shop-phone-section").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/private/tmp/boss-phone-studio-${viewport.width}.png` });
    await page.locator(".studio-shop-phone-section strong").evaluate(el => { el.textContent = "1234567890".repeat(10); });
    assert.equal(await page.locator(".studio-shop-phone-section").evaluate(el => el.scrollWidth > el.clientWidth), false, "long phone overflow");
    mode = "live";
    await page.goto(`http://127.0.0.1:5173/studio/feedback/${id}?mode=live&view=unreplied`);
    await page.getByRole("heading", { name: item.nickname }).waitFor();
    assert.equal(await page.getByText(item.shopPhone, { exact: true }).count(), 0);
    assert.equal(await page.getByText("张导小店绑定手机号", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "导出留言", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}: phone draft + normal/live, XLSX/MD downloads + pagination/scope, dialog fit/keyboard${viewport.width === 375 ? ", error/empty/cancel" : ""}`);
    await context.close();
  }
} finally { await browser.close(); }
