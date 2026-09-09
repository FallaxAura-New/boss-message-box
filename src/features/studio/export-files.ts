import type { Worksheet } from "exceljs";
import { TOPIC_LABELS } from "../../shared/contracts";
import type { StudioFeedbackDetail } from "../../shared/studio-contracts";

export interface FeedbackExportOptions {
  scopeLabel: string;
  exportedAt: number;
  origin: string;
}

const IMAGE_NOTICE = "图片仅提供链接，查看或下载需要登录 Studio；导出文件不包含图片，不是离线图片备份。";
const STATUS_LABELS = { unreplied: "未回复", replied: "已回复", filtered: "已过滤" };
const MODERATION_LABELS = { pending: "待审核", kept: "已保留", filtered: "已过滤", failed: "审核失败" };
const CATEGORY_LABELS = { valid_feedback: "有效留言", abusive: "辱骂攻击", meaningless: "无意义", uncertain: "不确定" };

function timestamp(value: number): string {
  return `${new Date(value + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC+8`;
}

function absoluteLink(path: string, origin: string): string {
  const url = new URL(path, origin);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("导出链接地址无效");
  return url.href.replace(/[()'<>]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function detailLink(item: StudioFeedbackDetail, origin: string): string {
  return absoluteLink(`/studio/feedback/${encodeURIComponent(item.id)}`, origin);
}

function shopPhone(item: StudioFeedbackDetail): string {
  return item.shopPhone ?? "";
}

function topic(item: StudioFeedbackDetail): string {
  return item.topic === "other" ? item.customTopic ?? TOPIC_LABELS.other : TOPIC_LABELS[item.topic];
}

// Keep user-supplied Markdown and HTML literal, including headings and image syntax.
function escapeMarkdown(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+\-.!|~]/g, "\\$&");
}

function quoted(value: string): string {
  return escapeMarkdown(value).split(/\r\n|\r|\n/).map((line) => `> ${line}`).join("  \n");
}

function markdown(items: StudioFeedbackDetail[], options: FeedbackExportOptions): string {
  const lines = [
    "# Studio 留言导出", "", "## 导出范围", "", quoted(options.scopeLabel), "",
    `导出时间：${timestamp(options.exportedAt)}`, "", `留言数量：${items.length}`, "", IMAGE_NOTICE, "",
  ];
  for (const item of items) {
    lines.push(`## 留言 ${escapeMarkdown(item.feedbackNumber)}`, "");
    const fields: [string, string][] = [
      ["完整 ID", item.id], ["抖音昵称", item.nickname], ["张导小店绑定手机号", shopPhone(item) || "未填写"],
      ["主题", topic(item)], ["提交时间", timestamp(item.createdAt)], ["状态", STATUS_LABELS[item.status]],
      ["待办", item.isTodo ? "是" : "否"], ["审核状态", MODERATION_LABELS[item.moderationStatus]],
      ["审核分类", item.moderationCategory ? CATEGORY_LABELS[item.moderationCategory] : "无"],
      ["审核原因", item.moderationReason ?? "无"],
    ];
    for (const [label, value] of fields) lines.push(`- ${label}：${escapeMarkdown(value).split(/\r\n|\r|\n/).join("\n  ")}`);
    lines.push("", `[在 Studio 查看留言](<${detailLink(item, options.origin)}>)`, "", "### 留言全文", "", quoted(item.content), "");
    lines.push(`### 回复（${item.replies.length}）`, "");
    if (!item.replies.length) lines.push("暂无回复。", "");
    for (const [index, reply] of item.replies.entries()) {
      lines.push(`#### 回复 ${index + 1}`, "", quoted(`回复 ID：${reply.id}`), "",
        quoted(`类型：${reply.replyType === "live" ? "直播回复" : "文字回复"}`), "",
        quoted(`回复人：${reply.adminUsername ?? "未记录"}`), "", quoted(`时间：${timestamp(reply.createdAt)}`), "",
        quoted(reply.content), "");
    }
    lines.push(`### 图片（${item.images.length}）`, "");
    if (!item.images.length) lines.push("无图片。", "");
    for (const [index, picture] of item.images.entries()) {
      lines.push(`- 图片 ${index + 1}：${picture.width} × ${picture.height}，${picture.byteSize} 字节；` +
        `[查看](<${absoluteLink(picture.viewUrl, options.origin)}>) · ` +
        `[下载](<${absoluteLink(picture.downloadUrl, options.origin)}>)`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function addTextTable(sheet: Worksheet, headers: [string, number][], rows: (string | number | null)[][]): void {
  sheet.columns = headers.map(([header, width]) => ({ header, width }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: headers.length } };
  for (const values of rows) {
    // Strings are deliberately never converted to formula, number, or hyperlink objects.
    if (values.some((value) => typeof value === "string" && value.length > 32_767)) throw new Error("单个字段超过 Excel 的 32767 字符上限，请改用 Markdown 导出。");
    sheet.addRow(values);
  }
  sheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.numFmt = typeof cell.value === "number" ? "0" : "@";
      cell.alignment = { vertical: "top", wrapText: true };
      if (rowNumber === 1) {
        cell.font = { bold: true, color: { argb: "FFF3F8FD" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF152C41" } };
      }
    });
  });
}

export async function buildFeedbackExport(
  items: StudioFeedbackDetail[],
  format: "xlsx" | "md",
  options: FeedbackExportOptions,
): Promise<Blob> {
  if (format === "md") return new Blob([markdown(items, options)], { type: "text/markdown;charset=utf-8" });
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Studio";
  workbook.created = new Date(options.exportedAt);
  addTextTable(workbook.addWorksheet("留言与回复"), [
    ["编号", 16], ["完整 ID", 40], ["抖音昵称", 24], ["张导小店绑定手机号", 26], ["主题", 28], ["留言全文", 80],
    ["提交时间（UTC+8）", 30], ["状态", 12], ["待办", 10], ["审核状态", 14], ["审核分类", 16], ["审核原因", 48],
    ["回复数量", 12], ["图片数量", 12], ["最近回复人", 20], ["用户 ID", 40], ["Studio 详情链接", 65],
    ["回复序号", 12], ["回复 ID", 40], ["回复类型", 14], ["回复人", 20], ["回复时间（UTC+8）", 30], ["回复全文", 80],
  ], items.flatMap((item) => {
    const feedbackValues = [
      item.feedbackNumber, item.id, item.nickname, shopPhone(item), topic(item), item.content, timestamp(item.createdAt),
      STATUS_LABELS[item.status], item.isTodo ? "是" : "否", MODERATION_LABELS[item.moderationStatus],
      item.moderationCategory ? CATEGORY_LABELS[item.moderationCategory] : "", item.moderationReason ?? "",
      item.replies.length, item.images.length, item.latestReplyAdmin ?? "", item.userId ?? "", detailLink(item, options.origin),
    ];
    if (!item.replies.length) return [[...feedbackValues, null, null, null, null, null, null]];
    return item.replies.map((reply, index) => [
      ...feedbackValues, index + 1, reply.id, reply.replyType === "live" ? "直播回复" : "文字回复",
      reply.adminUsername ?? "", timestamp(reply.createdAt), reply.content,
    ]);
  }));
  addTextTable(workbook.addWorksheet("图片"), [
    ["留言编号", 16], ["留言完整 ID", 40], ["图片 ID", 40], ["格式", 16], ["大小（字节）", 16],
    ["宽度", 12], ["高度", 12], ["查看链接（需登录 Studio）", 65], ["下载链接（需登录 Studio）", 65],
  ], items.flatMap((item) => item.images.map((picture) => [
    item.feedbackNumber, item.id, picture.id, picture.mediaType, picture.byteSize, picture.width,
    picture.height, absoluteLink(picture.viewUrl, options.origin), absoluteLink(picture.downloadUrl, options.origin),
  ])));
  addTextTable(workbook.addWorksheet("导出说明"), [["项目", 24], ["说明", 90]], [
    ["导出范围", options.scopeLabel], ["导出时间", timestamp(options.exportedAt)], ["留言数量", items.length],
    ["图片说明", IMAGE_NOTICE], ["格式说明", "数量、图片字节大小和宽高按数字保存，可直接统计；编号、手机号和用户输入按文本保存，保留前导 0 和 +，不会作为公式执行。"],
    ["留言与回复", "每条回复占一行，同一留言的字段会随回复重复；没有回复的留言保留一行，回复字段为空。"],
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  // Copy into an ordinary ArrayBuffer for browser Blob compatibility.
  return new Blob([new Uint8Array(buffer).slice().buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
