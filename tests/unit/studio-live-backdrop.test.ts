import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIVE_BACKDROP, LIVE_BACKDROP_KEY, loadLiveBackdrop, saveLiveBackdrop } from "../../src/features/studio/live-backdrop";

afterEach(() => vi.restoreAllMocks());

describe("livestream backdrop preference", () => {
  it("defaults to the original background and round-trips a custom key color", () => {
    expect(loadLiveBackdrop()).toEqual(DEFAULT_LIVE_BACKDROP);
    expect(saveLiveBackdrop({ enabled: true, color: "#12AB34" })).toBe(true);
    expect(loadLiveBackdrop()).toEqual({ enabled: true, color: "#12ab34" });
    saveLiveBackdrop({ ...DEFAULT_LIVE_BACKDROP });
    expect(loadLiveBackdrop()).toEqual(DEFAULT_LIVE_BACKDROP);
  });

  it.each(["not-json", "null", "[]", '{"enabled":"yes","color":"#00ff00"}', '{"enabled":true,"color":"red; background:url(test)"}'])("ignores malformed or unsafe saved data: %s", (saved) => {
    localStorage.setItem(LIVE_BACKDROP_KEY, saved);
    expect(loadLiveBackdrop()).toEqual(DEFAULT_LIVE_BACKDROP);
  });

  it("keeps Studio usable when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadLiveBackdrop()).toEqual(DEFAULT_LIVE_BACKDROP);
    expect(saveLiveBackdrop({ enabled: true, color: "#00ff00" })).toBe(false);
  });
});
