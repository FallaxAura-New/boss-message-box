import { chromium, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

const output = mkdtempSync("/private/tmp/nradio-live-visual-");
const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) });
const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("留言");
sheet.addRow(["用户名", "用户留言"]); sheet.addRow(["导入测试观众", "希望介绍一下这款产品的实际使用体验。"]);
sheet.addRow(["超长测试", "长".repeat(2001)]); sheet.addRow([]); sheet.addRow(["", ""]);
const file = Buffer.from(await book.xlsx.writeBuffer());
const results = [];
try {
  for (const width of [375, 768, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let mode = "normal", routed = false, rotated = false, imported = false, importRouted = false;
    const batch = { id: "00000000-0000-4000-8000-000000000007", status: "active", startedAt: 1, archivedAt: null, count: 1, revision: 0 };
    const old = { ...batch, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "archived", archivedAt: Date.UTC(2026, 8, 10, 12, 30) };
    const item = { id: "11111111-1111-4111-8111-111111111111", feedbackNumber: "11111111", userId: null, nickname: "直播流程测试观众", topic: "appeal", customTopic: null,
      content: "希望工作人员帮忙确认售后问题的处理进度，并在直播中介绍正确的反馈方式。", contentPreview: "希望工作人员帮忙确认售后问题的处理进度。", imageCount: 0, images: [], replies: [], maskedPhone: null,
      createdAt: 1000, status: "unreplied", isTodo: false, replyCount: 0, latestReplyAdmin: null, moderationStatus: "kept", routingStatus: "pending", liveSelected: true, sourceType: "public", feedbackId: "11111111-1111-4111-8111-111111111111" };
    const importedRow = { jobId: "22222222-2222-4222-8222-222222222222", rowNumber: 2, nickname: "导入测试观众", content: "希望介绍一下这款产品的实际使用体验。",
      topic: "released_hardware", customTopic: null, routingStatus: "pending", filename: "留言.xlsx", createdAt: 1000 };
    const job = { id: importedRow.jobId, batchId: batch.id, filename: "留言.xlsx", createdAt: 1000, rows: [{ rowNumber: 2, nickname: importedRow.nickname, content: importedRow.content,
      status: "imported", errorCode: null, topic: importedRow.topic, customTopic: null, routingStatus: importRouted ? "not_selected" : "pending" }] };
    await page.route("**/api/studio/**", async route => {
      const url = new URL(route.request().url()), path = url.pathname;
      const reply = json => route.fulfill({ json });
      if (path.endsWith("/session/mode")) mode = route.request().postDataJSON().mode;
      if (path.endsWith("/session") || path.endsWith("/session/mode")) return reply({ ok: true, admin: { id: "fixture", username: "测试管理员" }, mode, expiresAt: Date.now() + 86400000 });
      if (path.endsWith("/stats")) return reply({ ok: true, todayFeedback: 1, unreplied: 1, todo: 0, todayReplied: 0 });
      if (path.endsWith("/feedbacks")) return reply({ ok: true, items: url.searchParams.get("view") === "routing" && routed ? [] : [item], pagination: { page: 1, pageSize: 30, total: 1, totalPages: 1 }, snapshot: null });
      if (path.includes("/live/routing/")) { routed = true; return reply({ ok: true }); }
      if (path.endsWith("/live/active")) return reply({ ok: true, batch });
      if (path.endsWith("/live/batches")) return reply({ ok: true, batches: [batch, old] });
      if (path.endsWith("/live/imports/routing")) {
        const items = imported && !importRouted ? [importedRow] : [];
        return reply({ ok: true, items, total: items.length, page: 1, pageSize: 30, totalPages: items.length ? 1 : 0 });
      }
      if (path.includes(`/live/imports/${job.id}/rows/`)) { importRouted = true; return reply({ ok: true }); }
      if (path.endsWith("/live/entries")) {
        const historical = url.searchParams.get("batchId") === old.id;
        const items = rotated && !historical ? [] : [item];
        return reply({ ok: true, batch: historical ? old : batch, items, total: items.length, page: 1, totalPages: 1 });
      }
      if (path.endsWith("/live/rotate")) { rotated = true; return reply({ ok: true, batch }); }
      if (path.endsWith("/live/imports")) {
        if (route.request().method() === "POST") { imported = true; return reply({ ok: true, job }); }
        return reply({ ok: true, jobs: imported ? [job] : [] });
      }
      if (path.endsWith(`/imports/${job.id}`)) return reply({ ok: true, job });
      if (path.endsWith("/live/sequence")) return reply({ ok: true, batchId: batch.id, feedbackId: rotated ? null : item.id, nextFeedbackId: null });
      if (path.endsWith(`/live/entries/${item.id}`)) return reply({ ok: true, item });
      if (path.endsWith("/new-feedback-count")) return reply({ ok: true, count: 0 });
      return route.fulfill({ status: 404, json: { ok: false, error: { message: "未配置的界面测试请求" } } });
    });
    const capture = async name => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) errors.push(`${name}: horizontal overflow`);
      await page.screenshot({ path: join(output, `${width}-${name}.png`), fullPage: true });
    };
    await page.goto(`${base}/studio/routing`);
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "加入直播展示", exact: true }).waitFor();
    await capture("routing");
    await page.getByRole("button", { name: "加入直播展示", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已加入直播展示");
    await page.goto(`${base}/studio/unreplied`);
    await page.getByText("已加入直播展示", { exact: true }).waitFor();
    await capture("membership");
    await page.goto(`${base}/studio/live-display`);
    await expect(page.getByRole("button", { name: "导入 Excel" })).toHaveCount(0);
    await capture("live-list");
    await page.goto(`${base}/studio/routing`);
    await page.getByRole("button", { name: "导入 Excel" }).waitFor();
    await page.getByRole("button", { name: "导入 Excel" }).click();
    await page.getByLabel("选择工作簿").setInputFiles({ name: "留言.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
    await page.getByText(/有效 1 行 · 无效 1 行/).waitFor();
    const confirm = page.getByRole("button", { name: "确认导入有效行" });
    const box = await confirm.boundingBox();
    if (!box || box.y < 0 || box.y + box.height > 800) errors.push("import confirmation clipped");
    await capture("import-preview");
    await confirm.click();
    await page.getByText(/本次 AI 分类已完成/).waitFor();
    await page.getByText("导入测试观众", { exact: true }).waitFor();
    await capture("import-complete");
    const importedCard = page.getByText("导入测试观众", { exact: true }).locator("xpath=ancestor::article");
    await importedCard.getByRole("button", { name: "不加入直播展示" }).click();
    await expect(page.getByText("Excel 第 2 行已标记为不加入直播展示。", { exact: true })).toHaveAttribute("role", "status");
    await page.goto(`${base}/studio/live-display`);
    await page.getByRole("combobox", { name: "按直播批次筛选" }).selectOption(old.id);
    await page.getByText(/历史批次只读/).waitFor();
    await expect(page.getByRole("button", { name: "导入 Excel" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "取消直播展示" })).toHaveCount(0);
    if (!page.url().includes(`batch=${old.id}`)) errors.push("history selection missing from URL");
    await capture("history");
    await page.reload(); await page.getByText(/历史批次只读/).waitFor();
    await page.getByRole("combobox", { name: "按直播批次筛选" }).selectOption("");
    await page.getByRole("button", { name: "刷新直播展示组" }).click();
    await expect(page.getByRole("dialog")).toContainText("当前批次共 1 条留言");
    await capture("rotate-confirm");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "刷新直播展示组" })).toBeFocused();
    await page.getByRole("button", { name: "刷新直播展示组" }).click();
    await page.getByRole("button", { name: "归档并开启空批次" }).click();
    await page.getByText("当前直播展示组为空", { exact: true }).waitFor();
    await capture("empty-batch");
    rotated = false;
    await page.goto(`${base}/studio/feedback/${item.id}?mode=live&view=live_display&batch=${batch.id}`);
    await page.getByRole("region", { name: "直播留言展示", exact: true }).waitFor();
    await capture("live-stage");
    await expect(page.getByRole("button", { name: "导入 Excel" })).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("status")).toContainText("已经是最新的一条留言了");
    results.push({ width, errors });
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ output, results }, null, 2));
if (results.some(result => result.errors.length)) process.exitCode = 1;
