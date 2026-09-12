import { z } from "zod";
import { topicSchema } from "./contracts";
import type { StudioFeedbackDetail } from "./studio-contracts";

export const LIVE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const LIVE_IMPORT_MAX_ROWS = 500;
export const routingStatusSchema = z.enum(["pending", "selected", "not_selected"]);
export const liveRoutingSchema = z.object({
  requestKey: z.string().uuid(),
  batchId: z.string().uuid(),
  routingStatus: z.enum(["selected", "not_selected"]),
}).strict();
export const liveRotateSchema = z.object({ requestKey: z.string().uuid(), batchId: z.string().uuid() }).strict();
export const liveMoveSchema = liveRotateSchema.extend({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  position: z.number().int().min(1).max(300_000),
}).strict();
export type LiveMoveInput = z.infer<typeof liveMoveSchema>;
export const liveImportRowSchema = z.object({
  rowNumber: z.number().int().min(2).max(LIVE_IMPORT_MAX_ROWS + 1),
  nickname: z.string().trim().normalize().min(1, "用户名不能为空").max(40, "用户名不能超过 40 字符"),
  content: z.string().trim().min(1, "留言不能为空").max(2000, "留言不能超过 2000 字符"),
}).strict();
export const liveImportSchema = z.object({
  jobId: z.string().uuid(), batchId: z.string().uuid(),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/u),
  filename: z.string().trim().min(1).max(200).regex(/\.xlsx$/iu),
  fileSize: z.number().int().min(1).max(LIVE_IMPORT_MAX_BYTES),
  rows: z.array(liveImportRowSchema).min(1).max(LIVE_IMPORT_MAX_ROWS),
}).strict().refine(v => new Set(v.rows.map(r => r.rowNumber)).size === v.rows.length, "Excel 行号不能重复");
export const liveClassificationSchema = z.object({
  topic: topicSchema, customTopic: z.string().trim().min(1).max(60).nullable(),
}).strict().refine(v => v.topic === "other" ? Boolean(v.customTopic && !/^(其他|其它|other)$/iu.test(v.customTopic)) : v.customTopic === null,
  "其他主题必须包含具体的分类名称");
export type LiveImportInput = z.infer<typeof liveImportSchema>;
export type LiveImportRow = z.infer<typeof liveImportRowSchema>;
export type LiveClassification = z.infer<typeof liveClassificationSchema>;
export type LiveImportRowStatus = "pending" | "processing" | "failed" | "imported";
export interface LiveBatch {
  id: string; startedAt: number; archivedAt: number | null; status: "active" | "archived"; count: number;
  revision: number;
}
export interface LiveEntry extends StudioFeedbackDetail {
  batchId: string; sourceType: "public" | "imported"; feedbackId: string | null;
  importOrder: number; addedAt: number; filename: string | null; importRowNumber: number | null;
  queueGroup: number; sortOrder: number;
}
export interface LiveListSuccess {
  ok: true; batch: LiveBatch; items: LiveEntry[]; total: number; page: number; totalPages: number;
}
export interface LiveImportJob {
  id: string; batchId: string; filename: string; createdAt: number;
  rows: Array<LiveImportRow & {
    status: LiveImportRowStatus; errorCode: string | null;
    topic: LiveClassification["topic"] | null; customTopic: string | null;
    routingStatus: z.infer<typeof routingStatusSchema> | null;
  }>;
}
export interface LiveImportRoutingItem extends LiveImportRow {
  jobId: string; filename: string; createdAt: number;
  topic: LiveClassification["topic"]; customTopic: string | null;
  routingStatus: "pending";
}
export interface LiveImportRoutingListSuccess {
  ok: true; items: LiveImportRoutingItem[]; page: number; pageSize: number; total: number; totalPages: number;
}
