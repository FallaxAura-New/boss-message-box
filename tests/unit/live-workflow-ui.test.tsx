import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LiveDisplayPage } from "../../src/features/studio/pages/LiveDisplayPage";
import { FeedbackListPage } from "../../src/features/studio/pages/FeedbackListPage";
import { LiveImportControl } from "../../src/features/studio/components/LiveImportControl";
import { resetLiveSequence } from "../../src/features/studio/live-sequence";

vi.mock("../../src/features/studio/import-xlsx", () => ({ parseLiveWorkbook: vi.fn(async () => ({
  filename: "留言.xlsx", fileSize: 4, fileHash: "a".repeat(64), rows: [{ rowNumber: 2, nickname: "导入昵称", content: "导入正文" }],
  emptyRows: 1, invalidRows: [{ rowNumber: 3, reason: "用户名不能超过 40 字符" }],
})) }));
const batch = { id: "00000000-0000-4000-8000-000000000007", startedAt: 1, archivedAt: null, status: "active", count: 1, revision: 0 };
const old = { ...batch, id: "11111111-1111-4111-8111-111111111111", status: "archived", archivedAt: Date.UTC(2026, 8, 10, 12, 30) };
const item = { id: "22222222-2222-4222-8222-222222222222", nickname: "观众昵称", feedbackNumber: "22222222", topic: "appeal", contentPreview: "正文", content: "正文", imageCount: 0, createdAt: 1,
  status: "unreplied", isTodo: false, replyCount: 0, latestReplyAdmin: null, moderationStatus: "kept", routingStatus: "pending", liveSelected: false,
  sourceType: "public", feedbackId: "22222222-2222-4222-8222-222222222222" };
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event("close")); };
});
afterEach(() => { vi.unstubAllGlobals(); resetLiveSequence(); });
function Location() { return <output aria-label="当前位置">{useLocation().search}</output>; }
function setup(path = "/studio/live-display", liveMode = false) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<><Outlet context={{ liveMode }} /><Location /></>}>
    <Route path="/studio/live-display" element={<LiveDisplayPage />} />
    <Route path="/studio/routing" element={<FeedbackListPage view="routing" />} />
  </Route></Routes></MemoryRouter>);
}
function mockApi() {
  let rotated = false;
  let failRotation = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/live/active")) return Response.json({ ok: true, batch });
    if (url.pathname.endsWith("/live/batches")) return Response.json({ ok: true, batches: [batch, old] });
    if (url.pathname.endsWith("/live/imports")) return Response.json({ ok: true, jobs: [] });
    if (url.pathname.endsWith("/live/entries")) {
      const historical = url.searchParams.get("batchId") === old.id;
      return Response.json({ ok: true, batch: historical ? old : batch, items: rotated && !historical ? [] : [item], total: rotated && !historical ? 0 : 1, page: 1, totalPages: 1 });
    }
    if (url.pathname.endsWith("/live/rotate")) {
      if (failRotation) return Response.json({ ok: false, error: { message: "网络暂时失败，请重试" } }, { status: 503 });
      rotated = true; return Response.json({ ok: true, batch: { ...batch, count: 0 } });
    }
    if (url.pathname.includes("/live/routing/")) return Response.json({ ok: true });
    if (url.pathname.endsWith("/feedbacks")) return Response.json({ ok: true, items: [item], pagination: { page: 1, pageSize: 30, total: 1, totalPages: 1 }, snapshot: null });
    if (url.pathname.endsWith("/stats")) return Response.json({ ok: true, todayFeedback: 1, unreplied: 0, todo: 0, todayReplied: 0 });
    throw new Error(`Unexpected request ${String(input)} ${init?.method}`);
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, failRotation: (value: boolean) => { failRotation = value; } };
}
describe("routing and live-batch interfaces", () => {
  it("removes a routed card immediately and announces success", async () => {
    const { fetch } = mockApi(); const user = userEvent.setup(); setup("/studio/routing");
    await user.click(await screen.findByRole("button", { name: "加入直播展示" }));
    await waitFor(() => expect(screen.queryByText("观众昵称")).not.toBeInTheDocument());
    expect(screen.getByText("已加入直播展示，同时进入未回复列表。")).toHaveAttribute("role", "status");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("stores history selection in the URL, uses UTC+8 and renders history read-only", async () => {
    mockApi(); const user = userEvent.setup(); setup();
    const select = await screen.findByRole("combobox", { name: "按直播批次筛选" });
    await screen.findByRole("option", { name: /2026.*09.*10.*20:30.*刷新/ });
    expect(screen.queryByRole("combobox", { name: "按留言主题筛选" })).not.toBeInTheDocument();
    await user.selectOptions(select, old.id);
    expect(await screen.findByText(/历史批次只读/)).toBeInTheDocument();
    expect(screen.getByLabelText("当前位置")).toHaveTextContent(`batch=${old.id}`);
    expect(screen.queryByRole("button", { name: "导入 Excel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新直播展示组" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消直播资格" })).not.toBeInTheDocument();
  });
  it("confirms the batch count, shows retry errors inside the modal and reuses the request key", async () => {
    const fixture = mockApi(); fixture.failRotation(true);
    const user = userEvent.setup(); setup();
    const trigger = await screen.findByRole("button", { name: "刷新直播展示组" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "刷新直播展示组？" });
    expect(dialog).toHaveTextContent("当前批次共 1 条留言");
    expect(dialog).toHaveTextContent("不会删除");
    await user.click(within(dialog).getByRole("button", { name: "归档并开启空批次" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("请重试");
    fixture.failRotation(false);
    await user.click(within(dialog).getByRole("button", { name: "归档并开启空批次" }));
    await screen.findByText("当前直播展示组为空");
    const calls = fixture.fetch.mock.calls.filter(([input]) => String(input).endsWith("/rotate"));
    expect(calls).toHaveLength(2); expect(calls[0]?.[1]?.body).toBe(calls[1]?.[1]?.body);
  });
  it("previews without writing and uploads the original file only after confirmation", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, job: { id: "job" } })); vi.stubGlobal("fetch", fetch);
    const created = vi.fn(); const user = userEvent.setup();
    render(<LiveImportControl batchId={batch.id} onCreated={created} />);
    const trigger = screen.getByRole("button", { name: "导入 Excel" });
    await user.click(trigger);
    await user.upload(screen.getByLabelText("选择工作簿"), new File(["file"], "留言.xlsx"));
    expect(await screen.findByText("有效 1 行 · 无效 1 行 · 空白 1 行")).toBeInTheDocument();
    expect(screen.getByText("用户名不能超过 40 字符")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认导入有效行" }));
    expect(created).toHaveBeenCalledWith("job");
    expect(fetch.mock.calls).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
  });
});
