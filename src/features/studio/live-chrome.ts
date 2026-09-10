export interface LiveChrome {
  /** Keeps the 底色 / 全屏 / 退出 buttons on screen instead of fading them out when idle. */
  pinned: boolean;
}

export const LIVE_CHROME_KEY = "studio.live-chrome.v1";
export const DEFAULT_LIVE_CHROME: LiveChrome = { pinned: false };
/** Idle time before the live control cluster fades out of the captured picture. */
export const LIVE_CHROME_IDLE_MS = 3000;

export function loadLiveChrome(): LiveChrome {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LIVE_CHROME_KEY) ?? "null");
    if (saved && typeof saved === "object" && "pinned" in saved && typeof saved.pinned === "boolean") {
      return { pinned: saved.pinned };
    }
  } catch {
    // A blocked or damaged local preference must never prevent entering live mode.
  }
  return { ...DEFAULT_LIVE_CHROME };
}

export function saveLiveChrome(value: LiveChrome): boolean {
  try {
    localStorage.setItem(LIVE_CHROME_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
