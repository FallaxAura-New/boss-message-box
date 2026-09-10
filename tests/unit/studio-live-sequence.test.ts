import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateLiveFeedback,
  loadLiveFeedback,
  loadLiveNeighbor,
  readLiveFeedback,
  readLiveNeighbor,
  resetLiveSequence,
  warmLiveSequence,
} from "../../src/features/studio/live-sequence";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

const CHAIN = [A, B, C, D];

function detail(id: string) {
  return {
    id,
    feedbackNumber: id.slice(0, 8),
    userId: null,
    nickname: `观众 ${CHAIN.indexOf(id)}`,
    topic: "released_hardware",
    customTopic: null,
    content: "留言正文",
    contentPreview: "留言正文",
    imageCount: 0,
    images: [],
    maskedPhone: null,
    createdAt: 1_700_000_000_000 + CHAIN.indexOf(id),
    status: "unreplied",
    isTodo: false,
    replyCount: 0,
    latestReplyAdmin: null,
    replies: [],
    moderationStatus: "kept",
    moderationCategory: "valid_feedback",
    moderationReason: null,
  };
}

interface Fixture {
  fetchMock: ReturnType<typeof vi.fn>;
  detailCalls: string[];
  nextCalls: string[];
  failNext?: () => boolean;
  failDetail?: () => boolean;
}

function mockApi(options: { failNext?: () => boolean; failDetail?: () => boolean } = {}): Fixture {
  const detailCalls: string[] = [];
  const nextCalls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, "http://localhost").pathname;
    if (path.endsWith("/next")) {
      if (options.failNext?.()) throw new TypeError("Failed to fetch");
      const index = CHAIN.indexOf(path.split("/").at(-2) ?? "");
      const direction = new URL(url, "http://localhost").searchParams.get("direction");
      nextCalls.push(`${CHAIN[index]?.slice(0, 1)}:${direction}`);
      const target = direction === "previous" ? CHAIN[index - 1] : CHAIN[index + 1];
      return Response.json({ ok: true, nextFeedbackId: target ?? null });
    }
    const matched = path.match(/\/feedbacks\/([0-9a-f-]+)$/);
    if (matched?.[1] && CHAIN.includes(matched[1])) {
      if (options.failDetail?.()) throw new TypeError("Failed to fetch");
      detailCalls.push(matched[1].slice(0, 1));
      return Response.json({ ok: true, item: detail(matched[1]) });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, detailCalls, nextCalls };
}

afterEach(() => {
  resetLiveSequence();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("live sequence cache", () => {
  it("keys details and cursors by batch and clears both on rotation", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const batchId = url.searchParams.get("batchId");
      return Response.json(url.pathname.endsWith("/sequence") ? { ok: true, nextFeedbackId: B, batchId } : { ok: true, item: { ...detail(A), nickname: batchId }, batchId });
    });
    vi.stubGlobal("fetch", fetch);
    await loadLiveFeedback(A, "batch-a");
    expect(readLiveFeedback(A, "batch-b")).toBeNull();
    await loadLiveFeedback(A, "batch-b");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(readLiveFeedback(A, "batch-a")?.nickname).toBe("batch-a");
    await loadLiveNeighbor({ id: A, view: "live_display", topic: null, direction: "next", batchId: "batch-a" });
    expect(readLiveNeighbor({ id: A, view: "live_display", topic: null, direction: "next", batchId: "batch-b" })).toBeUndefined();
    resetLiveSequence();
    expect(readLiveFeedback(A, "batch-a")).toBeNull();
    expect(readLiveFeedback(A, "batch-b")).toBeNull();
  });
  it("serves a repeated message from memory instead of the network", async () => {
    const fixture = mockApi();
    const first = await loadLiveFeedback(A);
    const second = await loadLiveFeedback(A);

    expect(second).toBe(first);
    expect(fixture.detailCalls).toEqual(["1"]);
    expect(readLiveFeedback(A)?.nickname).toBe("观众 0");
  });

  it("deduplicates identical requests that overlap", async () => {
    const fixture = mockApi();
    const [first, second] = await Promise.all([loadLiveFeedback(A), loadLiveFeedback(A)]);

    expect(second).toBe(first);
    expect(fixture.detailCalls).toEqual(["1"]);
  });

  it("remembers the end of the sequence so the boundary costs nothing", async () => {
    const fixture = mockApi();
    expect(await loadLiveNeighbor({ id: D, view: "unreplied", topic: null, direction: "next" })).toBeNull();
    expect(readLiveNeighbor({ id: D, view: "unreplied", topic: null, direction: "next" })).toBeNull();

    await loadLiveNeighbor({ id: D, view: "unreplied", topic: null, direction: "next" });
    expect(fixture.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps separate cursors for each list view", async () => {
    mockApi();
    expect(await loadLiveNeighbor({ id: A, view: "unreplied", topic: null, direction: "next" })).toBe(B);
    expect(readLiveNeighbor({ id: A, view: "todo", topic: null, direction: "next" })).toBeUndefined();
    expect(readLiveNeighbor({ id: A, view: "unreplied", topic: "appeal", direction: "next" })).toBeUndefined();
  });

  it("warms both neighbours and the step after them", async () => {
    const fixture = mockApi();
    warmLiveSequence({ id: B, view: "unreplied", topic: null });

    await vi.waitFor(() => {
      expect(readLiveFeedback(A)).not.toBeNull();
      expect(readLiveFeedback(C)).not.toBeNull();
    });
    // One step further is primed with a detail request so a double press stays instant.
    await vi.waitFor(() => expect(readLiveFeedback(D)).not.toBeNull());
    expect(readLiveNeighbor({ id: C, view: "unreplied", topic: null, direction: "next" })).toBe(D);
    // The message already on screen is never refetched by warming.
    expect([...fixture.detailCalls].sort()).toEqual(["1", "3", "4"]);
    expect(readLiveFeedback(B)).toBeNull();
  });

  it("survives a failing neighbour lookup without rejecting", async () => {
    mockApi({ failNext: () => true });
    warmLiveSequence({ id: A, view: "unreplied", topic: null });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(readLiveNeighbor({ id: A, view: "unreplied", topic: null, direction: "next" })).toBeUndefined();
    expect(readLiveFeedback(B)).toBeNull();
  });

  it("drops everything when the live session ends", async () => {
    const fixture = mockApi();
    await loadLiveFeedback(A);
    expect(readLiveFeedback(A)).not.toBeNull();

    resetLiveSequence();
    expect(readLiveFeedback(A)).toBeNull();
    expect(readLiveNeighbor({ id: A, view: "unreplied", topic: null, direction: "next" })).toBeUndefined();

    await loadLiveFeedback(A);
    expect(fixture.detailCalls).toEqual(["1", "1"]);
  });

  it("refetches a single message after it is invalidated", async () => {
    const fixture = mockApi();
    await loadLiveFeedback(A);
    invalidateLiveFeedback(A);
    expect(readLiveFeedback(A)).toBeNull();

    await loadLiveFeedback(A);
    expect(fixture.detailCalls).toEqual(["1", "1"]);
  });

  it("rethrows a detail failure so the caller can show the error state", async () => {
    mockApi({ failDetail: () => true });
    await expect(loadLiveFeedback(A)).rejects.toThrow();
  });
});
