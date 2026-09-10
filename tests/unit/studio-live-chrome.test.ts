import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIVE_CHROME,
  LIVE_CHROME_KEY,
  loadLiveChrome,
  saveLiveChrome,
} from "../../src/features/studio/live-chrome";

afterEach(() => vi.restoreAllMocks());

describe("livestream control visibility preference", () => {
  it("defaults to auto-hiding and round-trips the pinned choice", () => {
    expect(loadLiveChrome()).toEqual(DEFAULT_LIVE_CHROME);
    expect(saveLiveChrome({ pinned: true })).toBe(true);
    expect(loadLiveChrome()).toEqual({ pinned: true });
    saveLiveChrome({ ...DEFAULT_LIVE_CHROME });
    expect(loadLiveChrome()).toEqual(DEFAULT_LIVE_CHROME);
  });

  it.each(["not-json", "null", "[]", '{"pinned":"yes"}', '{"pinned":1}'])(
    "ignores malformed or unsafe saved data: %s",
    (saved) => {
      localStorage.setItem(LIVE_CHROME_KEY, saved);
      expect(loadLiveChrome()).toEqual(DEFAULT_LIVE_CHROME);
    },
  );

  it("keeps live mode usable when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadLiveChrome()).toEqual(DEFAULT_LIVE_CHROME);
    expect(saveLiveChrome({ pinned: true })).toBe(false);
  });
});
