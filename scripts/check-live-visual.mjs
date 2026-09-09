import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const baseUrl = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5173";
const id = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";
try {
  for (const viewport of [{ width: 375, height: 700 }, { width: 768, height: 800 }, { width: 1280, height: 700 }]) {
    if (process.argv[2] && viewport.width !== Number(process.argv[2])) continue;
    const context = await browser.newContext({ viewport, reducedMotion: viewport.width === 1280 ? "no-preference" : "reduce" });
    const page = await context.newPage();
    let mode = "normal";
    let long = false;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const writes = [];
    const navigationDirections = [];
    const image = { id: "image", viewUrl: "/fixture.svg", downloadUrl: "/fixture.svg", width: 800, height: 450 };
    const item = (itemId = id) => ({ id: itemId, feedbackNumber: "11111111", userId: null, nickname: long ? "测试很长的抖音昵称需要完整展示不能被裁切" : itemId === id ? "爱折腾的观众" : "下一条测试留言", topic: "released_hardware", customTopic: null, content: long ? "长留言开始。" + "这是用于验证滚动范围的测试内容。".repeat(100) + "长留言结束。" : itemId === id ? "希望下一次直播能聊聊新产品的实际体验。\n这张图是我想分享的小建议。" : "这是一条用于验证上一条与下一条切换的留言。", contentPreview: "测试留言", imageCount: 1, images: [image], maskedPhone: null, createdAt: itemId === id ? 1000 : 900, status: "unreplied", isTodo: false, replyCount: 1, latestReplyAdmin: "测试管理员", replies: [{ id: "reply", replyType: "live", content: "绝不能出现在直播画面的历史回复", createdAt: 1000 }], moderationStatus: "kept", moderationCategory: "valid_feedback", moderationReason: null });
    await page.route("**/fixture.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#152c41"/><circle cx="400" cy="205" r="105" fill="#4edfff"/><text x="400" y="375" text-anchor="middle" fill="#f3f8fd" font-size="30">TEST IMAGE</text></svg>' }));
    await page.route("**/api/studio/**", route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (request.method() !== "GET") writes.push(path);
      if (path.endsWith("/session/mode")) mode = request.postDataJSON().mode;
      if (path.endsWith("/session") || path.endsWith("/session/mode")) return route.fulfill({ json: { ok: true, admin: { id: "fixture", username: "测试管理员" }, mode, expiresAt: Date.now() + 86400000 } });
      if (path.endsWith("/stats")) return route.fulfill({ json: { ok: true, todayFeedback: 1, unreplied: 1, todo: 0, todayReplied: 0 } });
      if (path.endsWith("/new-feedback-count")) return route.fulfill({ json: { ok: true, count: 0 } });
      if (path.endsWith("/feedbacks")) return route.fulfill({ json: { ok: true, items: [item()], pagination: { page: 1, pageSize: 30, total: 1, totalPages: 1 }, snapshot: { createdAt: 1000, id } } });
      if (path.endsWith("/next")) {
        const currentId = path.split("/").at(-2);
        const direction = url.searchParams.get("direction") ?? "next";
        navigationDirections.push(direction);
        const adjacentId = long
          ? null
          : direction === "next"
            ? currentId === id ? nextId : null
            : currentId === nextId ? id : null;
        return route.fulfill({ json: { ok: true, nextFeedbackId: adjacentId } });
      }
      const detailId = path.match(/\/feedbacks\/([^/]+)$/)?.[1];
      if (detailId) return route.fulfill({ json: { ok: true, item: item(detailId) } });
      return route.fulfill({ status: 404, json: { ok: false } });
    });
    await page.goto(`${baseUrl}/studio/unreplied`);
    await page.locator(".studio-feedback-card").waitFor();
    if (viewport.width < 1024) await page.locator(".studio-mobile-menu > summary").click();
    await page.locator(".studio-live-toggle:visible").click();
    await page.getByRole("heading", { name: "爱折腾的观众" }).waitFor({ timeout: 10000 }).catch(async error => { console.log(page.url(), await page.locator("body").innerText(), errors); throw error; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.studio-live-stage')).display === 'grid');
    await page.locator('.studio-live-stage').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    assert.match(page.url(), /feedback\/.*mode=live/);
    assert.equal(await page.locator(".studio-reply-composer, .studio-reply-history, .studio-detail-heading").count(), 0);
    assert.equal(await page.getByText("鹏友", { exact: true }).count(), 0, "obsolete live label is still visible");
    assert.equal(await page.getByText("已发布硬件", { exact: true }).count(), 1, "topic is missing below the nickname");
    assert.equal(await page.getByText("主题", { exact: true }).count(), 0, "topic label should stay hidden");
    assert.equal(await page.getByRole("button", { name: "上一条", exact: true }).count(), 0, "previous button is still visible");
    assert.equal(await page.getByRole("button", { name: "下一条", exact: true }).count(), 0, "next button is still visible");
    const exitBox = await page.getByRole("button", { name: "退出直播模式", exact: true }).boundingBox();
    assert(exitBox && exitBox.y >= 0 && exitBox.y + exitBox.height <= viewport.height, "exit action clipped");
    const textBox = await page.locator(".studio-live-message-text").boundingBox();
    const thumbnailBox = await page.locator(".studio-live-images").boundingBox();
    assert(textBox && thumbnailBox && textBox.x + textBox.width <= thumbnailBox.x + 1, "image thumbnails are not to the right of the message");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `/private/tmp/boss-live-${viewport.width}.png` });

    await page.keyboard.press("ArrowRight");
    await page.getByRole("heading", { name: "下一条测试留言" }).waitFor();
    assert.match(page.url(), new RegExp(nextId));
    await page.keyboard.press("ArrowLeft");
    await page.getByRole("heading", { name: "爱折腾的观众" }).waitFor();
    assert.match(page.url(), new RegExp(id));
    assert.deepEqual(navigationDirections.slice(-2), ["next", "previous"], "arrow keys did not request the expected directions");

    // Keying changes only the canvas, never foreground styles or uploaded media.
    const foreground = () => page.evaluate(() => [
      ['.studio-live-identity', 'backgroundColor'], ['.studio-live-identity h1', 'color'],
      ['.studio-live-message', 'backgroundImage'], ['.studio-live-message-text > p', 'color'],
      ['.studio-live-images button', 'backgroundColor'],
    ].map(([selector, property]) => getComputedStyle(document.querySelector(selector))[property]));
    const originalForeground = await foreground();
    await page.getByRole('button', { name: '抠像底色', exact: true }).click();
    const backdrop = page.getByRole('dialog', { name: '抠像底色' });
    const settingsBox = await backdrop.boundingBox();
    assert(settingsBox && settingsBox.x >= 0 && settingsBox.y >= 0 && settingsBox.x + settingsBox.width <= viewport.width && settingsBox.y + settingsBox.height <= viewport.height, 'backdrop settings clipped');
    assert.equal(await backdrop.getByRole('checkbox').isChecked(), false);
    await backdrop.getByRole('button', { name: '绿幕', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.studio-live-stage')).backgroundColor === 'rgb(0, 255, 0)');
    await page.screenshot({ path: `/private/tmp/boss-live-chroma-settings-${viewport.width}.png` });
    await backdrop.getByRole('button', { name: '完成', exact: true }).click();
    await page.mouse.move(0, 0);
    assert.deepEqual(await foreground(), originalForeground, 'foreground palette changed');
    assert.equal(await page.locator('.studio-live-stage').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 255, 0)');
    assert.equal(await page.locator('.studio-live-stage').evaluate(el => getComputedStyle(el, '::before').display), 'none', 'gradient pollutes key color');
    assert.equal(await page.locator('.studio-live-message').evaluate(el => getComputedStyle(el).boxShadow), 'none', 'shadow pollutes key color');
    await page.screenshot({ path: `/private/tmp/boss-live-chroma-${viewport.width}.png` });
    await page.reload();
    await page.getByRole('heading', { name: item().nickname }).waitFor();
    await page.locator('.studio-live-stage').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    assert.equal(await page.locator('.studio-live-stage').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 255, 0)', 'key color was not restored');
    await page.getByRole('button', { name: '抠像底色', exact: true }).click();
    await backdrop.getByLabel('自定义颜色').fill('#1234ef');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.studio-live-stage')).backgroundColor === 'rgb(18, 52, 239)');
    await page.keyboard.press('Escape');
    assert.equal(await backdrop.isVisible(), false);
    assert.equal(await page.locator('.studio-live-stage').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(18, 52, 239)');
    assert(await page.getByRole('button', { name: '抠像底色', exact: true }).evaluate(el => document.activeElement === el), 'dialog did not restore focus');
    await page.getByRole('button', { name: '抠像底色', exact: true }).click();
    await backdrop.getByRole('button', { name: '恢复原背景' }).click();
    await backdrop.getByRole('button', { name: '完成', exact: true }).click();
    assert.equal(await page.locator('.studio-shell').getAttribute('data-chroma'), null);
    assert.equal(await page.locator('.studio-live-stage').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(14, 23, 28)');

    await page.getByRole("button", { name: "放大留言图片 1" }).click();
    await page.getByRole("dialog").waitFor();
    const detailUrlBeforeLightboxKey = page.url();
    const navigationCountBeforeLightboxKey = navigationDirections.length;
    await page.keyboard.press("ArrowRight");
    assert.equal(page.url(), detailUrlBeforeLightboxKey, "message navigation ran while the image lightbox was open");
    assert.equal(navigationDirections.length, navigationCountBeforeLightboxKey, "message navigation API ran while the image lightbox was open");
    await page.getByRole("button", { name: "关闭图片" }).click();
    long = true;
    await page.reload();
    await page.getByRole("heading", { name: item().nickname }).waitFor();
    await page.locator('.studio-live-stage').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    const scroll = page.locator(".studio-live-message-text");
    assert(await scroll.evaluate(el => el.querySelector("p").getBoundingClientRect().top >= el.getBoundingClientRect().top), "long message start inaccessible");
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert(await scroll.evaluate(el => el.querySelector("p").getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1), "long message end inaccessible");
    const imageBox = await page.getByRole("button", { name: "放大留言图片 1" }).boundingBox();
    assert(imageBox && imageBox.y < viewport.height && imageBox.y + imageBox.height <= viewport.height + 1, "thumbnail became inaccessible while reading long text");
    await page.keyboard.press("ArrowRight");
    await page.getByRole("status").filter({ hasText: "已经是最后一条留言了" }).waitFor();
    await page.getByRole("button", { name: "退出直播模式" }).click();
    await page.getByRole("heading", { name: "未回复留言" }).waitFor();
    assert(writes.every(path => path.endsWith("/session/mode")), "unexpected write");
    assert.deepEqual(errors, []);
    console.log(`PASS live ${viewport.width}×${viewport.height}: keyboard-only navigation, responsive text-left/media-right layout, chroma isolation, long-content access, lightbox, exit`);
    await context.close();
  }
} finally { await browser.close(); }
