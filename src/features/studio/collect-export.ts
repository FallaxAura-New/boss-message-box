import type { StudioExportInput, StudioFeedbackDetail } from "../../shared/studio-contracts";
import { getStudioExport } from "./api";

export async function collectStudioExport(
  input: Omit<StudioExportInput, "before">,
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<StudioFeedbackDetail[]> {
  const items: StudioFeedbackDetail[] = [];
  let snapshot = input.snapshot;
  let before: StudioExportInput["before"] = null;
  const cursors = new Set<string>();
  do {
    signal.throwIfAborted();
    const page = await getStudioExport({ ...input, snapshot, before }, signal);
    signal.throwIfAborted();
    snapshot = page.snapshot;
    items.push(...page.items);
    onProgress(items.length);
    before = page.nextCursor;
    if (before) {
      const key = `${before.createdAt}:${before.id}`;
      if (cursors.has(key)) throw new Error("导出分页异常，请刷新列表后重试");
      cursors.add(key);
    }
  } while (before);
  return items;
}
