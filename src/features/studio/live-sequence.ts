import type {
  StudioFeedbackDetail,
  StudioFeedbackView,
} from "../../shared/studio-contracts";
import type { Topic } from "../../shared/contracts";
import { getNextStudioFeedback, getStudioFeedback } from "./api";
import { clearLiveImages, preloadLiveImage } from "./live-images";

/**
 * Live-mode sequence cache.
 *
 * Flipping through messages with the arrow keys used to cost two sequential round trips
 * (resolve the neighbour, then load its detail) plus the image download, so a press felt
 * like nothing happened. This module keeps a short-lived window around the message on
 * screen: the neighbouring ids, their details, and their images. Pressing an arrow key
 * then renders from memory, and only falls back to the network when the window is cold.
 *
 * Everything here is scoped to one live session. `resetLiveSequence` cancels in-flight
 * work and drops all cached content when live mode is left.
 */
const DETAIL_TTL_MS = 45_000;
const NEIGHBOR_TTL_MS = 45_000;
const MAX_DETAILS = 10;
const MAX_NEIGHBORS = 40;

interface Stamped<T> {
  value: T;
  at: number;
}

const details = new Map<string, Stamped<StudioFeedbackDetail>>();
const neighbors = new Map<string, Stamped<string | null>>();
const detailTasks = new Map<string, Promise<StudioFeedbackDetail>>();
const neighborTasks = new Map<string, Promise<string | null>>();
let scope = new AbortController();

function isFresh<T>(entry: Stamped<T> | undefined, ttl: number): entry is Stamped<T> {
  return Boolean(entry) && Date.now() - entry!.at < ttl;
}

function store<K, V>(map: Map<K, Stamped<V>>, key: K, value: V, limit: number): void {
  map.delete(key);
  map.set(key, { value, at: Date.now() });
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

function neighborKey(input: {
  id: string;
  view: StudioFeedbackView;
  topic: Topic | null;
  direction: "previous" | "next";
}): string {
  return [input.view, input.topic ?? "", input.id, input.direction].join("|");
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/** Cancels prefetching and drops everything cached for the live session that just ended. */
export function resetLiveSequence(): void {
  scope.abort();
  scope = new AbortController();
  details.clear();
  neighbors.clear();
  detailTasks.clear();
  neighborTasks.clear();
  clearLiveImages();
}

/** Returns a cached message when it is still fresh, otherwise null. */
export function readLiveFeedback(feedbackId: string): StudioFeedbackDetail | null {
  const entry = details.get(feedbackId);
  return isFresh(entry, DETAIL_TTL_MS) ? entry.value : null;
}

export function invalidateLiveFeedback(feedbackId: string): void {
  details.delete(feedbackId);
}

/** Loads a message, reusing a fresh cache entry or an identical in-flight request. */
export async function loadLiveFeedback(feedbackId: string): Promise<StudioFeedbackDetail> {
  const cached = readLiveFeedback(feedbackId);
  if (cached) return cached;
  const inFlight = detailTasks.get(feedbackId);
  if (inFlight) return inFlight;
  const signal = scope.signal;
  const task = getStudioFeedback(feedbackId, signal).then((response) => {
    if (!signal.aborted) store(details, feedbackId, response.item, MAX_DETAILS);
    return response.item;
  });
  detailTasks.set(feedbackId, task);
  try {
    return await task;
  } finally {
    if (detailTasks.get(feedbackId) === task) detailTasks.delete(feedbackId);
  }
}

function preloadFeedbackImages(item: StudioFeedbackDetail): void {
  for (const image of item.images) void preloadLiveImage(image.viewUrl);
}

function prefetchLiveFeedback(feedbackId: string): Promise<StudioFeedbackDetail | null> {
  return loadLiveFeedback(feedbackId)
    .then((item) => {
      preloadFeedbackImages(item);
      return item;
    })
    .catch(() => null);
}

/** Returns a cached neighbour id: a string, null for "end of sequence", or undefined when unknown. */
export function readLiveNeighbor(input: {
  id: string;
  view: StudioFeedbackView;
  topic: Topic | null;
  direction: "previous" | "next";
}): string | null | undefined {
  const entry = neighbors.get(neighborKey(input));
  return isFresh(entry, NEIGHBOR_TTL_MS) ? entry.value : undefined;
}

export async function loadLiveNeighbor(input: {
  id: string;
  view: StudioFeedbackView;
  topic: Topic | null;
  direction: "previous" | "next";
}): Promise<string | null> {
  const key = neighborKey(input);
  const entry = neighbors.get(key);
  if (isFresh(entry, NEIGHBOR_TTL_MS)) return entry.value;
  const inFlight = neighborTasks.get(key);
  if (inFlight) return inFlight;
  const signal = scope.signal;
  const task = getNextStudioFeedback(input.id, input.view, input.topic, input.direction, signal)
    .then((response) => {
      if (!signal.aborted) store(neighbors, key, response.nextFeedbackId, MAX_NEIGHBORS);
      return response.nextFeedbackId;
    });
  neighborTasks.set(key, task);
  try {
    return await task;
  } finally {
    if (neighborTasks.get(key) === task) neighborTasks.delete(key);
  }
}

async function warmDirection(input: {
  id: string;
  view: StudioFeedbackView;
  topic: Topic | null;
  direction: "previous" | "next";
}): Promise<void> {
  const first = await loadLiveNeighbor(input).catch(() => null);
  if (!first) return;
  const [second] = await Promise.all([
    loadLiveNeighbor({ ...input, id: first }).catch(() => null),
    prefetchLiveFeedback(first),
  ]);
  // Two steps ahead keeps a quick double press instant; images still arrive with the detail above.
  if (second) void prefetchLiveFeedback(second);
}

/**
 * Warms the messages either side of the one on screen. Safe to call repeatedly: every
 * request is deduplicated and cached, so a repeat is almost free.
 */
export function warmLiveSequence(input: {
  id: string;
  view: StudioFeedbackView;
  topic: Topic | null;
}): void {
  if (!isVisible()) return;
  void warmDirection({ ...input, direction: "next" });
  void warmDirection({ ...input, direction: "previous" });
}
