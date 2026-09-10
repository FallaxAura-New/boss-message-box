/**
 * Live-mode image cache.
 *
 * Studio image responses are deliberately sent with `Cache-Control: private, no-store`,
 * so the browser re-downloads them on every visit, even inside one page session. On a
 * livestream that shows up as a picture that pops in a second late. Prefetching the
 * neighbouring messages' images and holding them as object URLs keeps switching instant
 * without loosening the server-side caching policy.
 *
 * The cache is bounded and lives only for the current live session: leaving live mode
 * revokes every object URL.
 */
const MAX_ENTRIES = 16;
const MAX_BYTES = 48 * 1024 * 1024;

interface CachedImage {
  objectUrl: string;
  bytes: number;
}

const cached = new Map<string, CachedImage>();
const pending = new Map<string, Promise<void>>();
let storedBytes = 0;
let generation = 0;

function objectUrlsAvailable(): boolean {
  return typeof URL !== "undefined"
    && typeof URL.createObjectURL === "function"
    && typeof URL.revokeObjectURL === "function";
}

function touch(source: string): void {
  const entry = cached.get(source);
  if (!entry) return;
  cached.delete(source);
  cached.set(source, entry);
}

function evict(): void {
  while (cached.size > MAX_ENTRIES || storedBytes > MAX_BYTES) {
    const oldest = cached.keys().next();
    if (oldest.done) return;
    const entry = cached.get(oldest.value);
    cached.delete(oldest.value);
    if (!entry) continue;
    storedBytes -= entry.bytes;
    URL.revokeObjectURL(entry.objectUrl);
  }
}

/** Returns the object URL held for an image path, or null when it is not cached yet. */
export function readLiveImage(viewUrl: string): string | null {
  const entry = cached.get(viewUrl);
  if (!entry) return null;
  touch(viewUrl);
  return entry.objectUrl;
}

export function preloadLiveImage(viewUrl: string): Promise<void> {
  if (!objectUrlsAvailable()) return Promise.resolve();
  const existing = cached.get(viewUrl);
  if (existing) {
    touch(viewUrl);
    return Promise.resolve();
  }
  const inFlight = pending.get(viewUrl);
  if (inFlight) return inFlight;
  const startedAt = generation;
  const task = fetch(viewUrl, { credentials: "same-origin", cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return;
      const blob = await response.blob();
      if (!blob.size || blob.size > MAX_BYTES) return;
      // A late response must never repopulate a cache that has already been cleared.
      if (startedAt !== generation || cached.has(viewUrl)) return;
      const objectUrl = URL.createObjectURL(blob);
      cached.set(viewUrl, { objectUrl, bytes: blob.size });
      storedBytes += blob.size;
      evict();
    })
    .catch(() => undefined)
    .finally(() => {
      if (pending.get(viewUrl) === task) pending.delete(viewUrl);
    });
  pending.set(viewUrl, task);
  return task;
}

export function clearLiveImages(): void {
  generation += 1;
  pending.clear();
  if (objectUrlsAvailable()) {
    for (const entry of cached.values()) URL.revokeObjectURL(entry.objectUrl);
  }
  cached.clear();
  storedBytes = 0;
}
