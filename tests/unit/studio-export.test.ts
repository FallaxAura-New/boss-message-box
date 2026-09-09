import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectStudioExport } from "../../src/features/studio/collect-export";
import { getStudioExport } from "../../src/features/studio/api";
vi.mock("../../src/features/studio/api", () => ({ getStudioExport: vi.fn() }));
const api = vi.mocked(getStudioExport);
const snapshot = { createdAt: 1000, id: "first" };
const cursor = { createdAt: 900, id: "last" };
const input = { view: "unreplied" as const, topic: "appeal" as const, snapshot: null };
beforeEach(() => api.mockReset());
describe("collectStudioExport", () => {
  it("carries scope and snapshot across all batches", async () => {
    api.mockResolvedValueOnce({ ok: true, items: [], snapshot, nextCursor: cursor })
      .mockResolvedValueOnce({ ok: true, items: [], snapshot, nextCursor: null });
    const signal = new AbortController().signal;
    const progress = vi.fn();
    await collectStudioExport(input, signal, progress);
    expect(api).toHaveBeenNthCalledWith(2, { ...input, snapshot, before: cursor }, signal);
    expect(progress).toHaveBeenCalledTimes(2);
  });
  it("never returns a partial export after a failed batch", async () => {
    api.mockResolvedValueOnce({ ok: true, items: [], snapshot, nextCursor: cursor }).mockRejectedValueOnce(new Error("网络中断"));
    await expect(collectStudioExport(input, new AbortController().signal, vi.fn())).rejects.toThrow("网络中断");
  });
  it("stops cancelled and repeated-cursor exports", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(collectStudioExport(input, controller.signal, vi.fn())).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
    api.mockResolvedValue({ ok: true, items: [], snapshot, nextCursor: cursor });
    await expect(collectStudioExport(input, new AbortController().signal, vi.fn())).rejects.toThrow("导出分页异常");
    expect(api).toHaveBeenCalledTimes(2);
  });
});
