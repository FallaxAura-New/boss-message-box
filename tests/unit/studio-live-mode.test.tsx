import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";

const feedbackId = "22222222-2222-4222-8222-222222222222";
const batch = { id: "00000000-0000-4000-8000-000000000007", startedAt: 1, archivedAt: null, status: "active", count: 0 };

const item = {
  id: feedbackId,
  feedbackNumber: "22222222",
  userId: null,
  nickname: "测试昵称",
  topic: "appeal",
  customTopic: null,
  content: "完整留言",
  contentPreview: "完整留言",
  imageCount: 0,
  images: [],
  maskedPhone: null,
  createdAt: 1000,
  status: "unreplied",
  isTodo: false,
  replyCount: 0,
  latestReplyAdmin: null,
  replies: [],
  moderationStatus: "kept",
  moderationCategory: "valid_feedback",
  moderationReason: null,
};

function mockSessionApi(oldestId: string) {
  let mode = "normal";
  const startRequests: string[] = [];
  const modeRequests: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(rawUrl, "http://localhost").pathname;
    if (path === "/api/studio/session") {
      return Response.json({ ok: true, admin: { id: "admin", username: "zd" }, mode, expiresAt: Date.now() + 86_400_000 });
    }
    if (path === "/api/studio/session/mode") {
      // A real round trip, so the window between navigating away and the session flipping
      // stays open the way it does in a browser.
      await new Promise((resolve) => setTimeout(resolve, 20));
      mode = (JSON.parse(String(init?.body)) as { mode: string }).mode;
      modeRequests.push(mode);
      return Response.json({ ok: true, admin: { id: "admin", username: "zd" }, mode, expiresAt: Date.now() + 86_400_000 });
    }
    if (path === "/api/studio/live/active") return Response.json({ ok: true, batch });
    if (path === "/api/studio/live/batches") return Response.json({ ok: true, batches: [batch] });
    if (path === "/api/studio/live/entries") return Response.json({ ok: true, batch, items: [], total: 0, page: 1, totalPages: 0 });
    if (path === "/api/studio/live/imports") return Response.json({ ok: true, jobs: [] });
    if (path === "/api/studio/live/sequence") {
      if (new URL(rawUrl, "http://localhost").searchParams.has("currentId")) return Response.json({ ok: true, nextFeedbackId: null, batchId: batch.id });
      startRequests.push(new URL(rawUrl, "http://localhost").search);
      return Response.json({ ok: true, feedbackId: mode === "live" ? oldestId : null, batchId: batch.id });
    }
    if (path.endsWith("/next")) return Response.json({ ok: true, nextFeedbackId: null });
    if (path === `/api/studio/feedbacks/${feedbackId}`) return Response.json({ ok: true, item });
    if (path.startsWith("/api/studio/live/entries/")) return Response.json({ ok: true, item: { ...item, id: path.split("/").at(-1) } });
    if (path === "/api/studio/feedbacks") {
      return Response.json({ ok: true, items: [], pagination: { page: 1, pageSize: 30, total: 0, totalPages: 0 }, snapshot: null });
    }
    if (path === "/api/studio/stats") {
      return Response.json({ ok: true, todayFeedback: 0, unreplied: 0, todo: 0, todayReplied: 0 });
    }
    if (path === "/api/studio/new-feedback-count") return Response.json({ ok: true, count: 0 });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, modeRequests, startRequests };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const oldestId = "11111111-1111-4111-8111-111111111111";

describe("live mode entry and exit", () => {
  it("opens the live run on the earliest entry of the current batch", async () => {
    window.history.replaceState(null, "", "/studio/live-display");
    const { startRequests } = mockSessionApi(oldestId);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "直播展示" });

    // The sidebar control and the mobile menu both expose the entry point.
    const [entry] = await screen.findAllByRole("button", { name: /直播展示模式/ });
    await user.click(entry!);

    await waitFor(() => expect(window.location.pathname).toBe(`/studio/feedback/${oldestId}`));
    expect(window.location.search).toContain("mode=live");
    expect(window.location.search).toContain("view=live_display");
    expect(window.location.search).toContain(`batch=${batch.id}`);
    expect(startRequests.every(q => q.includes(`batchId=${batch.id}`))).toBe(true);
    expect(startRequests.length).toBeGreaterThan(0);
  });

  it("clears ?mode=live and never flips the session back into live mode", async () => {
    const { modeRequests } = mockSessionApi(oldestId);
    window.history.replaceState(null, "", `/studio/feedback/${feedbackId}?mode=live&view=live_display&batch=${batch.id}`);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "测试昵称" });

    await user.click(screen.getByRole("button", { name: "退出直播模式" }));

    await waitFor(() => expect(window.location.pathname).toBe("/studio/unreplied"));
    expect(window.location.search).not.toContain("mode=live");
    await waitFor(() => expect(modeRequests).toContain("normal"));
    // Give a second, unwanted "live" request the chance to appear before asserting the absence.
    await new Promise((resolve) => setTimeout(resolve, 80));
    // Opening a ?mode=live URL synchronises the session once, then the exit flips it back.
    expect(modeRequests).toEqual(["live", "normal"]);
    expect(window.location.search).not.toContain("mode=live");
    expect(screen.getByRole("heading", { name: "未回复留言" })).toBeInTheDocument();
  });
});
