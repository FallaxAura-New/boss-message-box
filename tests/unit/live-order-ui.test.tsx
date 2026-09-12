import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveDisplayPage } from "../../src/features/studio/pages/LiveDisplayPage";
import { resetLiveSequence } from "../../src/features/studio/live-sequence";

const batchId = "00000000-0000-4000-8000-000000000007";
function Location() { return <div aria-label="位置">{useLocation().search}</div>; }
function setup(path = "/studio/live-display", liveMode = false) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<><Outlet context={{ liveMode }} /><Location /></>}>
    <Route path="/studio/live-display" element={<LiveDisplayPage />} />
  </Route></Routes></MemoryRouter>);
}
function fixture(count = 3, archived = false) {
  let revision = 4;
  const items = Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, nickname: `观众${i + 1}`, content: `留言${i + 1}`,
    contentPreview: `留言${i + 1}`, topic: "appeal", createdAt: i + 1, addedAt: 1, imageCount: 0,
    sourceType: i % 2 ? "imported" : "public", filename: "测试.xlsx", importRowNumber: i + 2, feedbackId: null,
  }));
  let failure = 0; let block: Promise<void> | undefined;
  const requests: Array<{ id: string; body: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const batch = { id: batchId, startedAt: 1, status: archived ? "archived" : "active", archivedAt: archived ? 2 : null, revision, count: items.length };
    if (url.pathname.endsWith("/batches")) return Response.json({ ok: true, batches: [batch] });
    if (url.pathname.endsWith("/entries")) {
      const page = Number(url.searchParams.get("page") ?? 1);
      return Response.json({ ok: true, batch, items: items.slice((page - 1) * 30, page * 30), total: items.length, page, totalPages: Math.ceil(items.length / 30) });
    }
    if (url.pathname.endsWith("/sequence")) return Response.json({ ok: true, feedbackId: null });
    if (url.pathname.endsWith("/move")) {
      const id = url.pathname.split("/").at(-2)!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ id, body });
      await block;
      if (failure) return Response.json({ ok: false, error: { message: failure === 409 ? "直播列表已变化，请重新加载后排序" : "网络暂时失败，请重试" } }, { status: failure });
      const index = items.findIndex(item => item.id === id);
      const [moved] = items.splice(index, 1); items.splice(Number(body.position) - 1, 0, moved!); revision++;
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  return { requests, fail: (status: number) => { failure = status; }, block: (value: Promise<void> | undefined) => { block = value; } };
}
afterEach(() => { vi.unstubAllGlobals(); resetLiveSequence(); });
const order = () => within(screen.getByRole("list", { name: "直播展示顺序" })).getAllByRole("heading").map(el => el.textContent);
const controls = (name: string) => screen.getByRole("form", { name: `${name}的展示顺序` });

describe("live ordering controls", () => {
  it("shows boundary states, saves a move, and retains the result after reopening", async () => {
    const api = fixture(); const user = userEvent.setup(); const view = setup();
    await screen.findByRole("form", { name: "观众1的展示顺序" });
    expect(within(controls("观众1")).getByRole("button", { name: "上移" })).toBeDisabled();
    expect(within(controls("观众3")).getByRole("button", { name: "下移" })).toBeDisabled();
    await user.click(within(controls("观众2")).getByRole("button", { name: "上移" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已移到第 1 条");
    expect(order()).toEqual(["观众2", "观众1", "观众3"]);
    expect(api.requests[0]?.body).toMatchObject({ batchId, position: 1, expectedRevision: 4 });
    view.unmount(); setup();
    await screen.findByRole("form", { name: "观众2的展示顺序" });
    expect(order()).toEqual(["观众2", "观众1", "观众3"]);
  });
  it("moves directly across pages using a keyboard-submitted position and follows the moved row", async () => {
    const api = fixture(31); const user = userEvent.setup(); setup("/studio/live-display?page=2");
    const input = await screen.findByRole("spinbutton", { name: "观众31的目标序号" });
    await user.clear(input); await user.type(input, "1{Enter}");
    await screen.findByRole("status");
    expect(api.requests[0]?.body.position).toBe(1);
    await waitFor(() => expect(order()[0]).toBe("观众31"));
    expect(screen.getByLabelText("位置")).not.toHaveTextContent("page=2");
    const moved = screen.getByRole("spinbutton", { name: "观众31的目标序号" });
    await user.clear(moved); await user.type(moved, "31{Enter}");
    await waitFor(() => expect(screen.getByLabelText("位置")).toHaveTextContent("page=2"));
    await waitFor(() => expect(order()).toEqual(["观众31"]));
  });
  it("locks concurrent operations, exposes saving state, and reuses the same request on retry", async () => {
    const api = fixture(); api.fail(503);
    let release!: () => void; api.block(new Promise<void>(resolve => { release = resolve; }));
    const user = userEvent.setup(); setup();
    await screen.findByRole("form", { name: "观众2的展示顺序" });
    await user.click(within(controls("观众2")).getByRole("button", { name: "上移" }));
    expect(screen.getByRole("button", { name: "保存中" })).toBeDisabled();
    expect(within(controls("观众1")).getByRole("button", { name: "下移" })).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    release();
    await screen.findByRole("alert"); expect(order()).toEqual(["观众1", "观众2", "观众3"]);
    api.fail(0); api.block(undefined);
    await user.click(screen.getByRole("button", { name: "重试保存" }));
    await screen.findByRole("status");
    expect(api.requests).toHaveLength(2);
    expect(api.requests[0]).toEqual(api.requests[1]);
    expect(order()).toEqual(["观众2", "观众1", "观众3"]);
  });
  it("requires refreshing a stale list instead of retrying a conflicting order", async () => {
    const api = fixture(); api.fail(409); const user = userEvent.setup(); setup();
    await screen.findByRole("form", { name: "观众2的展示顺序" });
    await user.click(within(controls("观众2")).getByRole("button", { name: "上移" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("列表已变化");
    expect(screen.queryByRole("button", { name: "重试保存" })).not.toBeInTheDocument();
    expect(within(controls("观众3")).getByRole("button", { name: "上移" })).toBeDisabled();
    api.fail(0); await user.click(screen.getByRole("button", { name: "重新加载列表" }));
    await waitFor(() => expect(within(controls("观众3")).getByRole("button", { name: "上移" })).toBeEnabled());
    expect(api.requests).toHaveLength(1);
  });
  it("does not send empty, fractional or out-of-range positions", async () => {
    const api = fixture(); const user = userEvent.setup(); setup();
    const input = await screen.findByRole("spinbutton", { name: "观众1的目标序号" });
    for (const value of ["", "0", "4", "1.5"]) {
      await user.clear(input); if (value) await user.type(input, value);
      await user.click(within(controls("观众1")).getByRole("button", { name: "移动" }));
    }
    expect(api.requests).toHaveLength(0);
  });
  it.each(["archive", "live", "empty"])("never exposes ordering in %s view", async mode => {
    const api = fixture(mode === "empty" ? 0 : 3, mode === "archive"); setup("/studio/live-display", mode === "live");
    await screen.findByText(`共 ${mode === "empty" ? 0 : 3} 条`);
    expect(screen.queryByRole("button", { name: "上移" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(api.requests).toHaveLength(0);
  });
});
