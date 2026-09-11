import {
  liveClassificationSchema,
  liveImportSchema,
  type LiveClassification,
  type LiveImportInput,
  type LiveImportJob,
  type LiveImportRoutingListSuccess,
} from "../../src/shared/live-contracts";
import type { Topic } from "../../src/shared/contracts";
import { STUDIO_PAGE_SIZE } from "../../src/shared/studio-contracts";
import { PublicError } from "../core/errors";
import type { Env } from "../env";
import { D1LiveRepository } from "../infra/d1-live-repository";
import { OpenAICompatibleModerationProvider } from "../providers/ai-moderation";

interface WorkRow { job_id: string; row_number: number; nickname: string; content: string }
const MAX_CONCURRENCY = 3;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
async function hash(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
}

export class LiveImportService {
  private live: D1LiveRepository;
  constructor(private readonly db: D1Database, private readonly classify: (content: string) => Promise<LiveClassification>) {
    this.live = new D1LiveRepository(db);
  }
  async create(raw: LiveImportInput, adminId: string, now: number): Promise<LiveImportJob> {
    const input = liveImportSchema.parse(raw);
    const rows = [...input.rows].sort((a, b) => a.rowNumber - b.rowNumber);
    const payloadHash = await hash(JSON.stringify(rows));
    const existing = await this.db.prepare(`SELECT id, batch_id, file_hash, payload_hash FROM live_import_jobs WHERE id = ? OR (batch_id = ? AND file_hash = ?)`)
      .bind(input.jobId, input.batchId, input.fileHash).all<{ id: string; batch_id: string; file_hash: string; payload_hash: string }>();
    if (existing.results.length) {
      if (existing.results.some(j => j.batch_id !== input.batchId || j.file_hash !== input.fileHash || j.payload_hash !== payloadHash)) {
        throw new PublicError(409, "REQUEST_CONFLICT", "此导入标识对应的内容不同，请重新选择文件");
      }
      return this.job(existing.results[0]!.id);
    }
    await this.live.requireActive(input.batchId);
    const statements = [this.db.prepare(`INSERT INTO live_import_jobs
      (id, batch_id, file_hash, payload_hash, filename, file_size, row_count, created_by, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM live_batches WHERE id = ? AND status = 'active')
      ON CONFLICT DO NOTHING`)
      .bind(input.jobId, input.batchId, input.fileHash, payloadHash, input.filename, input.fileSize, rows.length, adminId, now, input.batchId)];
    // Small JSON chunks avoid D1's per-value limit even with 500 long CJK messages.
    for (let offset = 0; offset < rows.length; offset += 20) {
      statements.push(this.db.prepare(`INSERT INTO live_import_rows(job_id, row_number, nickname, content)
        SELECT ?, json_extract(value, '$.rowNumber'), json_extract(value, '$.nickname'), json_extract(value, '$.content') FROM json_each(?)
        WHERE EXISTS (SELECT 1 FROM live_import_jobs WHERE id = ? AND payload_hash = ?)
        ON CONFLICT DO NOTHING`).bind(input.jobId, JSON.stringify(rows.slice(offset, offset + 20)), input.jobId, payloadHash));
    }
    statements.push(this.db.prepare(`INSERT INTO live_audit_logs(id, request_key, admin_id, action, batch_id, target_id, created_at)
      SELECT ?, ?, ?, 'import_created', ?, ?, ? WHERE EXISTS (SELECT 1 FROM live_import_jobs WHERE id = ?)
      ON CONFLICT(admin_id, request_key) DO NOTHING`).bind(crypto.randomUUID(), input.jobId, adminId, input.batchId, input.jobId, now, input.jobId));
    await this.db.batch(statements);
    const persisted = await this.db.prepare("SELECT id, payload_hash FROM live_import_jobs WHERE batch_id = ? AND file_hash = ?")
      .bind(input.batchId, input.fileHash).first<{ id: string; payload_hash: string }>();
    if (!persisted || persisted.payload_hash !== payloadHash) throw new PublicError(409, "REQUEST_CONFLICT", "批次或导入内容已变化，请刷新后重试");
    return this.job(persisted.id);
  }
  async job(id: string): Promise<LiveImportJob> {
    const job = await this.db.prepare("SELECT id, batch_id, filename, created_at FROM live_import_jobs WHERE id = ?")
      .bind(id).first<{ id: string; batch_id: string; filename: string; created_at: number }>();
    if (!job) throw new PublicError(404, "NOT_FOUND", "导入任务不存在");
    const rows = await this.db.prepare(`SELECT row_number, nickname, content, status, error_code, topic, custom_topic, routing_status
      FROM live_import_rows WHERE job_id = ? ORDER BY row_number`)
      .bind(id).all<{
        row_number: number; nickname: string; content: string; status: LiveImportJob["rows"][number]["status"];
        error_code: string | null; topic: Topic | null; custom_topic: string | null;
        routing_status: LiveImportJob["rows"][number]["routingStatus"];
      }>();
    return { id: job.id, batchId: job.batch_id, filename: job.filename, createdAt: job.created_at,
      rows: rows.results.map(r => ({
        rowNumber: r.row_number, nickname: r.nickname, content: r.content, status: r.status,
        errorCode: r.error_code, topic: r.topic, customTopic: r.custom_topic, routingStatus: r.routing_status,
      })) };
  }
  async jobs(batchId: string): Promise<Array<Pick<LiveImportJob, "id" | "filename" | "createdAt" | "batchId">>> {
    const r = await this.db.prepare("SELECT id, filename, created_at, batch_id FROM live_import_jobs WHERE batch_id = ? ORDER BY created_at DESC LIMIT 50")
      .bind(batchId).all<{ id: string; filename: string; created_at: number; batch_id: string }>();
    return r.results.map(j => ({ id: j.id, filename: j.filename, createdAt: j.created_at, batchId: j.batch_id }));
  }
  async routing(page: number, topic: Topic | null): Promise<LiveImportRoutingListSuccess> {
    const where = `r.status = 'imported' AND r.routing_status = 'pending'${topic ? " AND r.topic = ?" : ""}`;
    const bindings = topic ? [topic] : [];
    const [rows, count] = await this.db.batch([
      this.db.prepare(`SELECT r.job_id, r.row_number, r.nickname, r.content, r.topic, r.custom_topic,
        r.routing_status, j.filename, j.created_at
        FROM live_import_rows r JOIN live_import_jobs j ON j.id = r.job_id
        WHERE ${where}
        ORDER BY j.created_at DESC, j.id DESC, r.row_number ASC
        LIMIT ? OFFSET ?`).bind(...bindings, STUDIO_PAGE_SIZE, (page - 1) * STUDIO_PAGE_SIZE),
      this.db.prepare(`SELECT COUNT(*) AS total FROM live_import_rows r WHERE ${where}`).bind(...bindings),
    ]);
    const total = Number((count.results[0] as { total: number } | undefined)?.total ?? 0);
    return {
      ok: true,
      items: (rows.results as Array<{
        job_id: string; row_number: number; nickname: string; content: string; topic: Topic;
        custom_topic: string | null; routing_status: "pending"; filename: string; created_at: number;
      }>).map(row => ({
        jobId: row.job_id, rowNumber: row.row_number, nickname: row.nickname, content: row.content,
        topic: row.topic, customTopic: row.custom_topic, routingStatus: row.routing_status,
        filename: row.filename, createdAt: row.created_at,
      })),
      page,
      pageSize: STUDIO_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / STUDIO_PAGE_SIZE),
    };
  }
  async route(input: {
    jobId: string; rowNumber: number; batchId: string; requestKey: string;
    routingStatus: "selected" | "not_selected"; adminId: string; now: number;
  }): Promise<void> {
    const action = input.routingStatus === "selected" ? "routing_selected" : "routing_not_selected";
    const target = `${input.jobId}:${input.rowNumber}`;
    if (await this.live.replayed(input.adminId, input.requestKey, action, target, input.batchId)) return;
    await this.live.requireActive(input.batchId);
    const auditId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const bind = (sql: string, ...args: unknown[]) => this.db.prepare(sql).bind(...args);
    await this.db.batch([
      bind(`INSERT INTO live_audit_logs(id, request_key, admin_id, action, batch_id, target_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ? FROM live_import_rows r
        WHERE r.job_id = ? AND r.row_number = ? AND r.status = 'imported' AND r.routing_status = 'pending'
          AND r.topic IS NOT NULL
          AND EXISTS (SELECT 1 FROM live_batches WHERE id = ? AND status = 'active')
        ON CONFLICT(admin_id, request_key) DO NOTHING`,
      auditId, input.requestKey, input.adminId, action, input.batchId, target, input.now,
      input.jobId, input.rowNumber, input.batchId),
      bind(`UPDATE live_import_rows SET routing_status = ?
        WHERE job_id = ? AND row_number = ? AND routing_status = 'pending'
          AND EXISTS (SELECT 1 FROM live_audit_logs WHERE id = ?)`,
      input.routingStatus, input.jobId, input.rowNumber, auditId),
      ...(input.routingStatus === "selected" ? [
        bind(`INSERT INTO live_entries(id, batch_id, source_type, nickname, content, topic, custom_topic,
          source_created_at, import_order, added_at, added_by, import_job_id, import_row_number)
          SELECT ?, ?, 'imported', r.nickname, r.content, r.topic, r.custom_topic,
            j.created_at, r.row_number, ?, ?, r.job_id, r.row_number
          FROM live_import_rows r JOIN live_import_jobs j ON j.id = r.job_id
          WHERE r.job_id = ? AND r.row_number = ? AND r.status = 'imported' AND r.routing_status = 'selected'
            AND EXISTS (SELECT 1 FROM live_audit_logs WHERE id = ?)
          ON CONFLICT DO UPDATE SET
            batch_id = excluded.batch_id,
            nickname = excluded.nickname,
            content = excluded.content,
            topic = excluded.topic,
            custom_topic = excluded.custom_topic,
            source_created_at = excluded.source_created_at,
            import_order = excluded.import_order,
            queue_group = CASE
              WHEN EXISTS (SELECT 1 FROM live_batches WHERE id = excluded.batch_id AND playback_started_at IS NOT NULL)
                THEN live_entries.queue_group
              ELSE 0 END,
            added_at = excluded.added_at,
            added_by = excluded.added_by,
            removed_at = NULL,
            removed_by = NULL`,
        entryId, input.batchId, input.now, input.adminId, input.jobId, input.rowNumber, auditId),
      ] : []),
    ]);
    if (!await this.live.replayed(input.adminId, input.requestKey, action, target, input.batchId)) {
      throw new PublicError(409, "REQUEST_CONFLICT", "Excel 行已分流或批次已刷新，请刷新后重试");
    }
  }
  async retry(id: string, requestKey: string, adminId: string, rowNumbers: number[], now: number): Promise<LiveImportJob> {
    const job = await this.job(id);
    if (await this.live.replayed(adminId, requestKey, "import_retried", id, job.batchId)) return job;
    await this.live.requireActive(job.batchId);
    const auditId = crypto.randomUUID();
    await this.db.batch([
      this.db.prepare(`INSERT INTO live_audit_logs(id, request_key, admin_id, action, batch_id, target_id, created_at)
        SELECT ?, ?, ?, 'import_retried', ?, ?, ? WHERE EXISTS (SELECT 1 FROM live_batches WHERE id = ? AND status = 'active')
        ON CONFLICT(admin_id, request_key) DO NOTHING`).bind(auditId, requestKey, adminId, job.batchId, id, now, job.batchId),
      this.db.prepare(`UPDATE live_import_rows SET status = 'pending', error_code = NULL, attempt_token = NULL, lease_until = 0, attempts = 0
        WHERE job_id = ? AND status = 'failed' AND row_number IN (SELECT value FROM json_each(?))
        AND EXISTS (SELECT 1 FROM live_audit_logs WHERE id = ?)`)
        .bind(id, JSON.stringify(rowNumbers), auditId),
    ]);
    return this.job(id);
  }
  async run(now = Date.now()): Promise<void> {
    await this.db.prepare(`UPDATE live_import_rows SET status = 'failed', error_code = 'batch_archived', attempt_token = NULL
      WHERE status IN ('pending', 'processing') AND job_id IN
      (SELECT j.id FROM live_import_jobs j JOIN live_batches b ON b.id = j.batch_id WHERE b.status = 'archived')`).run();
    await this.db.prepare(`UPDATE live_import_rows SET status = 'failed', error_code = 'interrupted', attempt_token = NULL
      WHERE status = 'processing' AND lease_until <= ? AND attempts >= ?`).bind(now, MAX_ATTEMPTS).run();
    await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => this.runOne(now)));
  }
  private async runOne(now: number): Promise<void> {
    const token = crypto.randomUUID();
    const row = await this.db.prepare(`UPDATE live_import_rows SET status = 'processing', attempt_token = ?, lease_until = ?, attempts = attempts + 1
      WHERE (job_id, row_number) = (SELECT r.job_id, r.row_number FROM live_import_rows r
        JOIN live_import_jobs j ON j.id = r.job_id JOIN live_batches b ON b.id = j.batch_id
        WHERE b.status = 'active' AND (r.status = 'pending' OR (r.status = 'processing' AND r.lease_until <= ? AND r.attempts < ?))
        ORDER BY j.created_at, j.id, r.row_number LIMIT 1)
      AND (SELECT COUNT(*) FROM live_import_rows WHERE status = 'processing' AND lease_until > ?) < ?
      RETURNING job_id, row_number, nickname, content`)
      .bind(token, now + LEASE_MS, now, MAX_ATTEMPTS, now, MAX_CONCURRENCY).first<WorkRow>();
    if (!row) return;
    try {
      const classification = liveClassificationSchema.parse(await this.classify(row.content));
      await this.db.batch([
        this.db.prepare(`UPDATE live_import_rows SET status = 'imported', topic = ?, custom_topic = ?,
          routing_status = 'pending', error_code = NULL, attempt_token = NULL, lease_until = 0
          WHERE job_id = ? AND row_number = ? AND attempt_token = ? AND status = 'processing'
            AND EXISTS (SELECT 1 FROM live_import_jobs j JOIN live_batches b ON b.id = j.batch_id
              WHERE j.id = live_import_rows.job_id AND b.status = 'active')`)
          .bind(classification.topic, classification.customTopic, row.job_id, row.row_number, token),
        this.db.prepare(`UPDATE live_import_rows SET status = 'failed', error_code = 'batch_archived',
          attempt_token = NULL, lease_until = 0
          WHERE job_id = ? AND row_number = ? AND attempt_token = ? AND status = 'processing'`)
          .bind(row.job_id, row.row_number, token),
      ]);
    } catch {
      await this.db.prepare(`UPDATE live_import_rows SET status = 'failed', error_code = 'classification_failed', attempt_token = NULL, lease_until = 0
        WHERE job_id = ? AND row_number = ? AND attempt_token = ?`).bind(row.job_id, row.row_number, token).run();
    }
  }
}
export function createLiveImportService(env: Env): LiveImportService {
  const provider = new OpenAICompatibleModerationProvider(env.AI_BASE_URL ?? "", env.AI_API_KEY ?? "", env.AI_MODEL ?? "", 12_000, env.AI_THINKING);
  return new LiveImportService(env.BOSS_MESSAGE_DB, content => provider.classifyTopic(content));
}
