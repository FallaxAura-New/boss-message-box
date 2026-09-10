import { LIVE_IMPORT_MAX_BYTES, LIVE_IMPORT_MAX_ROWS, liveImportRowSchema, type LiveImportRow } from "./live-contracts";

export interface ImportPreview {
  filename: string; fileSize: number; fileHash: string; rows: LiveImportRow[]; emptyRows: number;
  invalidRows: Array<{ rowNumber: number; reason: string }>;
}
// Inspect the central directory before handing the archive to ExcelJS. XLSX files are
// ZIPs; a small compressed file must not expand into an unbounded workbook in the browser.
function checkArchive(bytes: ArrayBuffer): void {
  const view = new DataView(bytes);
  let end = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("文件不是有效的 .xlsx 工作簿");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  let expanded = 0;
  if (count > 2000) throw new Error("工作簿包含过多文件，请只保留留言工作表");
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("工作簿压缩结构无效");
    expanded += view.getUint32(cursor + 24, true);
    if (expanded > 16 * 1024 * 1024) throw new Error("工作簿解压后超过 16 MiB，请移除无关内容");
    cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
}
export async function parseLiveWorkbook(file: File): Promise<ImportPreview> {
  if (!/\.xlsx$/iu.test(file.name)) throw new Error("请选择 .xlsx 文件");
  if (!file.size || file.size > LIVE_IMPORT_MAX_BYTES) throw new Error("文件不能超过 2 MiB，也不能为空");
  const bytes = await file.arrayBuffer();
  checkArchive(bytes);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("工作簿没有工作表");
  if (sheet.rowCount > LIVE_IMPORT_MAX_ROWS + 1) throw new Error("最多支持 500 行（不含表头），请拆分后导入");
  const headers: Record<string, number[]> = {};
  sheet.getRow(1).eachCell((cell, column) => {
    const key = cell.text.trim();
    (headers[key] ??= []).push(column);
  });
  if (headers["用户名"]?.length !== 1 || headers["用户留言"]?.length !== 1) throw new Error("首行必须包含且只能各有一列“用户名”和“用户留言”");
  const rows: LiveImportRow[] = [];
  const invalidRows: ImportPreview["invalidRows"] = [];
  let emptyRows = 0;
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const nickname = row.getCell(headers["用户名"]![0]!);
    const content = row.getCell(headers["用户留言"]![0]!);
    if (!nickname.text.trim() && !content.text.trim()) { emptyRows++; continue; }
    if ([nickname, content].some(cell => typeof cell.value === "object" && cell.value !== null && ("formula" in cell.value || "sharedFormula" in cell.value))) {
      invalidRows.push({ rowNumber, reason: "用户名和留言须为文本，不能使用公式" }); continue;
    }
    const parsed = liveImportRowSchema.safeParse({ rowNumber, nickname: nickname.text, content: content.text });
    if (parsed.success) rows.push(parsed.data);
    else invalidRows.push({ rowNumber, reason: parsed.error.issues.map(issue => issue.message).join("；") });
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fileHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return { filename: file.name, fileSize: file.size, fileHash, rows, emptyRows, invalidRows };
}
