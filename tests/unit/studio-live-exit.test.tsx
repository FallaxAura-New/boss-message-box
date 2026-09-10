import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";

const feedbackId = "22222222-2222-4222-8222-222222222222";

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

function mockSessionApi() {
  let mode = "live";
  const modeRequests: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
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
    if (path.endsWith("/next")) return Response.json({ ok: true, nextFeedbackId: null });
    if (path === `/api/studio/feedbacks/${feedbackId}`) return Response.json({ ok: true, item });
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
  return { fetchMock, modeRequests };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("leaving live mode", () => {
  it("clears ?mode=live and never flips the session back into live mode", async () => {
    const { modeRequests } = mockSessionApi();
    window.history.replaceState(null, "", `/studio/feedback/${feedbackId}?mode=live&view=unreplied`);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "测试昵称" });

    await user.click(screen.getByRole("button", { name: "退出直播模式" }));

    await waitFor(() => expect(window.location.pathname).toBe("/studio/unreplied"));
    expect(window.location.search).not.toContain("mode=live");
    await waitFor(() => expect(modeRequests).toContain("normal"));
    // Give a second, unwanted "live" request the chance to appear before asserting the absence.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(modeRequests).toEqual(["normal"]);
    expect(window.location.search).not.toContain("mode=live");
    expect(screen.getByRole("heading", { name: "未回复留言" })).toBeInTheDocument();
  });
});
