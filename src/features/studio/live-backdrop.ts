export interface LiveBackdrop {
  enabled: boolean;
  color: string;
}

export const LIVE_BACKDROP_KEY = "studio.live-backdrop.v1";
export const DEFAULT_LIVE_BACKDROP: LiveBackdrop = { enabled: false, color: "#00ff00" };

export function loadLiveBackdrop(): LiveBackdrop {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LIVE_BACKDROP_KEY) ?? "null");
    if (saved && typeof saved === "object" && "enabled" in saved && "color" in saved
      && typeof saved.enabled === "boolean" && typeof saved.color === "string"
      && /^#[0-9a-f]{6}$/i.test(saved.color)) {
      return { enabled: saved.enabled, color: saved.color.toLowerCase() };
    }
  } catch {
    // A blocked or damaged local preference must never prevent entering Studio.
  }
  return { ...DEFAULT_LIVE_BACKDROP };
}

export function saveLiveBackdrop(value: LiveBackdrop): boolean {
  try {
    localStorage.setItem(LIVE_BACKDROP_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
