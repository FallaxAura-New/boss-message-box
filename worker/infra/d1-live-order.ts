import type { LiveMoveInput } from "../../src/shared/live-contracts";
import { PublicError } from "../core/errors";

export function liveEntryOrder(alias = "", direction: "ASC" | "DESC" = "ASC"): string {
  return ["sort_order", "queue_group", "source_created_at", "import_order", "id"]
    .map(column => `${alias}${column} ${direction}`).join(", ");
}

type MoveInput = LiveMoveInput & { entryId: string; adminId: string; now: number };
export async function moveLiveEntry(db: D1Database, input: MoveInput): Promise<void> {
  const replayed = async () => {
    const old = await db.prepare(`SELECT batch_id, entry_id, position, expected_revision FROM live_order_requests
      WHERE admin_id = ? AND request_key = ?`).bind(input.adminId, input.requestKey)
      .first<{ batch_id: string; entry_id: string; position: number; expected_revision: number }>();
    if (old && (old.batch_id !== input.batchId || old.entry_id !== input.entryId ||
      old.position !== input.position || old.expected_revision !== input.expectedRevision)) {
      throw new PublicError(409, "REQUEST_CONFLICT", "这次请求已经用过，请刷新后重试");
    }
    return Boolean(old);
  };
  if (await replayed()) return;
  const auditId = crypto.randomUUID();
  await db.batch([
    // Claim this exact revision inside the same transaction as the move. A concurrent
    // selection, removal, reorder or archive makes the entire operation a no-op.
    db.prepare(`INSERT INTO live_order_requests
      (id, admin_id, request_key, batch_id, entry_id, position, expected_revision, created_at)
      SELECT ?, ?, ?, b.id, ?, ?, ?, ? FROM live_batches b
      WHERE b.id = ? AND b.status = 'active' AND b.revision = ?
        AND EXISTS (SELECT 1 FROM live_entries WHERE id = ? AND batch_id = b.id AND removed_at IS NULL)
        AND ? <= (SELECT COUNT(*) FROM live_entries WHERE batch_id = b.id AND removed_at IS NULL)
      ON CONFLICT(admin_id, request_key) DO NOTHING`)
      .bind(auditId, input.adminId, input.requestKey, input.entryId, input.position, input.expectedRevision,
        input.now, input.batchId, input.expectedRevision, input.entryId, input.position),
    // Materialize before updating: dense, one-based positions cannot depend on rows
    // already changed by this UPDATE. The original timestamps and source IDs stay intact.
    db.prepare(`WITH ordered AS MATERIALIZED (
        SELECT id, ROW_NUMBER() OVER (ORDER BY ${liveEntryOrder()}) AS position
        FROM live_entries WHERE batch_id = ? AND removed_at IS NULL
      ), source AS (SELECT position FROM ordered WHERE id = ?)
      UPDATE live_entries SET sort_order = (
        SELECT CASE WHEN ordered.id = ? THEN ?
          WHEN source.position < ? AND ordered.position > source.position AND ordered.position <= ? THEN ordered.position - 1
          WHEN source.position > ? AND ordered.position >= ? AND ordered.position < source.position THEN ordered.position + 1
          ELSE ordered.position END FROM ordered, source WHERE ordered.id = live_entries.id
      ) WHERE batch_id = ? AND removed_at IS NULL
        AND EXISTS (SELECT 1 FROM live_order_requests WHERE id = ?)`)
      .bind(input.batchId, input.entryId, input.entryId, input.position, input.position, input.position,
        input.position, input.position, input.batchId, auditId),
    db.prepare(`UPDATE live_batches SET revision = revision + 1
      WHERE id = ? AND EXISTS (SELECT 1 FROM live_order_requests WHERE id = ?)`)
      .bind(input.batchId, auditId),
  ]);
  if (!await replayed()) throw new PublicError(409, "REQUEST_CONFLICT", "直播列表已变化，请重新加载后再排序");
}
