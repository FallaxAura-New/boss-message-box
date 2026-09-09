import type { StudioExportInput, StudioExportSuccess, StudioReplyType } from "../../src/shared/studio-contracts";
import { SUMMARY_SELECT, mapSummary, viewFilter, type SummaryRow } from "./d1-studio-repositories";

const EXPORT_BATCH_SIZE = 50;

/** Keyset pagination avoids skipping rows when earlier messages change status. */
export async function readStudioExport(db: D1Database, input: StudioExportInput): Promise<StudioExportSuccess> {
  const conditions = [input.view === "all" ? "1 = 1" : viewFilter(input.view)];
  const bindings: (string | number)[] = [];
  if (input.topic) {
    conditions.push("f.topic = ?");
    bindings.push(input.topic);
  }
  if (input.snapshot) {
    conditions.push("(f.created_at < ? OR (f.created_at = ? AND f.id <= ?))");
    bindings.push(input.snapshot.createdAt, input.snapshot.createdAt, input.snapshot.id);
  }
  if (input.before) {
    conditions.push("(f.created_at < ? OR (f.created_at = ? AND f.id < ?))");
    bindings.push(input.before.createdAt, input.before.createdAt, input.before.id);
  }
  const result = await db.prepare(`${SUMMARY_SELECT} WHERE ${conditions.join(" AND ")}
    ORDER BY f.created_at DESC, f.id DESC LIMIT ?`)
    .bind(...bindings, EXPORT_BATCH_SIZE + 1).all<SummaryRow>();
  const rows = result.results.slice(0, EXPORT_BATCH_SIZE);
  const snapshot = input.snapshot ?? (rows[0] ? { createdAt: rows[0].created_at, id: rows[0].id } : null);
  if (!rows.length) return { ok: true, items: [], snapshot, nextCursor: null };

  const ids = rows.map(row => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const [images, replies] = await db.batch([
    db.prepare(`SELECT id, feedback_id, media_type, byte_size, width, height FROM feedback_images
      WHERE feedback_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`).bind(...ids),
    db.prepare(`SELECT r.id, r.feedback_id, r.reply_type, r.content, r.created_at, a.username
      FROM feedback_replies r LEFT JOIN admins a ON a.id = r.admin_id
      WHERE r.feedback_id IN (${placeholders}) ORDER BY r.created_at ASC, r.id ASC`).bind(...ids),
  ]);
  const imageRows = images.results as Array<{ id: string; feedback_id: string; media_type: "image/webp"; byte_size: number; width: number; height: number }>;
  const replyRows = replies.results as Array<{ id: string; feedback_id: string; reply_type: StudioReplyType; content: string; created_at: number; username: string | null }>;
  const last = rows[rows.length - 1]!;
  return {
    ok: true, snapshot,
    nextCursor: result.results.length > EXPORT_BATCH_SIZE ? { createdAt: last.created_at, id: last.id } : null,
    items: rows.map(row => ({
      ...mapSummary(row), content: row.content, shopPhone: row.shop_phone, maskedPhone: null,
      images: imageRows.filter(image => image.feedback_id === row.id).map(image => ({
        id: image.id, mediaType: image.media_type, byteSize: image.byte_size, width: image.width, height: image.height,
        viewUrl: `/api/studio/feedbacks/${row.id}/images/${image.id}`,
        downloadUrl: `/api/studio/feedbacks/${row.id}/images/${image.id}?download=1`,
      })),
      replies: replyRows.filter(reply => reply.feedback_id === row.id).map(reply => ({
        id: reply.id, replyType: reply.reply_type, content: reply.content,
        createdAt: reply.created_at, adminUsername: reply.username,
      })),
    })),
  };
}
