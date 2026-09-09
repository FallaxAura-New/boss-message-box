import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, Route, Routes, MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FeedbackDetailPage } from "../../src/features/studio/pages/FeedbackDetailPage";

const feedbackId = "22222222-2222-4222-8222-222222222222";
const detail = {
  ok: true,
  item: {
    id: feedbackId,
    feedbackNumber: "22222222",
    userId: "11111111-1111-4111-8111-111111111111",
    nickname: "测试昵称",
    topic: "appeal",
    customTopic: null,
    contentPreview: "完整留言",
    content: "完整留言",
    imageCount: 0,
    images: [],
    maskedPhone: "1**********",
    shopPhone: "+853 6612-3456",
    createdAt: Date.UTC(2026, 8, 3),
    status: "unreplied",
    isTodo: false,
    replyCount: 0,
    latestReplyAdmin: null,
    replies: [],
    moderationStatus: "kept",
    moderationCategory: "valid_feedback",
    moderationReason: "有效反馈",
  },
};

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
});

afterEach(() => vi.unstubAllGlobals());

function renderDetail(liveMode: boolean) {
  return render(
    <MemoryRouter initialEntries={[`/studio/feedback/${feedbackId}${liveMode ? "?mode=live" : ""}`]}>
      <Routes>
        <Route element={<Outlet context={{ liveMode }} />}>
          <Route path="/studio/feedback/:feedbackId" element={<FeedbackDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function mockDetailApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if ((init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init?.body)) as { content: string; replyType?: string };
      return new Response(JSON.stringify({
        ok: true,
        reply: {
          id: "33333333-3333-4333-8333-333333333333",
          replyType: body.replyType ?? "live",
          content: body.content,
          adminUsername: "zd",
          createdAt: Date.UTC(2026, 8, 3, 1),
        },
        status: "replied",
        isTodo: false,
        replyCount: 1,
        latestReplyAdmin: "zd",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes(`/api/studio/feedbacks/${feedbackId}/next`)) {
      return new Response(JSON.stringify({ ok: true, nextFeedbackId: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes(`/api/studio/feedbacks/${feedbackId}`)) {
      return new Response(JSON.stringify(detail), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Studio reply interaction", () => {
  it("shows the shop phone directly in normal mode without a reveal action", async () => {
    mockDetailApi();
    renderDetail(false);
    expect(await screen.findByText("+853 6612-3456")).toBeInTheDocument();
    expect(screen.getByText("张导小店绑定手机号")).toBeInTheDocument();
  });

  it("requires confirmation for a normal-mode reply", async () => {
    const fetchMock = mockDetailApi();
    const user = userEvent.setup();
    renderDetail(false);
    await screen.findByRole("heading", { name: "申冤" });
    await user.click(screen.getByRole("radio", { name: "留言回复" }));
    await user.type(screen.getByRole("textbox", { name: "回复内容" }), "普通回复内容");
    await user.click(screen.getByRole("button", { name: "提交" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "确认提交这条回复？" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
  });

  it("shows only identity, message and images in live mode, even when replies exist", async () => {
    const fetchMock = mockDetailApi();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith(feedbackId)) {
        return Response.json({ ...detail, item: {
          ...detail.item,
          replies: [{ id: "reply", replyType: "live", content: "不应出现在直播画面的历史回复", createdAt: 1000, adminUsername: "zd" }],
          images: [{ id: "image", viewUrl: "/fixture.webp", downloadUrl: "/fixture.webp", width: 800, height: 600 }],
        } });
      }
      return original(input, init);
    });
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "测试昵称" });
    expect(screen.getByText("鹏友")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "留言内容" })).toHaveTextContent("完整留言");
    for (const hidden of ["申冤", "未回复", "#22222222", "手机号", "1**********", "张导小店绑定手机号", "+853 6612-3456", "提交时间", "历史回复", "不应出现在直播画面的历史回复", "直播回复", "追加回复"]) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "放大留言图片 1" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("retries a failed next-page request and disables advancing at the end without writing replies", async () => {
    const fetchMock = mockDetailApi();
    const original = fetchMock.getMockImplementation()!;
    let failNext = true;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes("/next?") && failNext) {
        failNext = false;
        throw new TypeError("Failed to fetch");
      }
      return original(input, init);
    });
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "测试昵称" });
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "已到最后一页" })).toBeDisabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("advances to the next message while retaining the live sequence and topic", async () => {
    const nextId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = mockDetailApi();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/next?")) return Response.json({ ok: true, nextFeedbackId: nextId });
      if (url.endsWith(nextId)) return Response.json({ ...detail, item: { ...detail.item, id: nextId, nickname: "下一位鹏友" } });
      return original(input, init);
    });
    vi.stubGlobal("scrollTo", vi.fn());
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/studio/feedback/${feedbackId}?mode=live&view=todo&topic=appeal`]}>
        <Routes><Route element={<Outlet context={{ liveMode: true }} />}>
          <Route path="/studio/feedback/:feedbackId" element={<FeedbackDetailPage />} />
        </Route></Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "测试昵称" });
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("heading", { name: "下一位鹏友" });
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/next?"))).toHaveLength(2));
    for (const [input] of fetchMock.mock.calls.filter(([input]) => String(input).includes("/next?"))) {
      expect(String(input)).toContain("view=todo&topic=appeal");
    }
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
});
