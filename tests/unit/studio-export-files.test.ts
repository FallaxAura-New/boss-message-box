import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildFeedbackExport } from "../../src/features/studio/export-files";
import type { StudioFeedbackDetail } from "../../src/shared/studio-contracts";

const options = { scopeLabel: "全部留言", exportedAt: Date.UTC(2026, 8, 9, 1, 2, 3), origin: "https://studio.example.com" };

function fixture(overrides: Partial<StudioFeedbackDetail & { shopPhone: string | null }> = {}): StudioFeedbackDetail {
  return {
    id: "4f2bdc50-90e5-480a-8731-c4b320b697a9", feedbackNumber: "000023", userId: null,
    nickname: "=HYPERLINK(\"https://example.com\",\"用户\")", topic: "other", customTopic: "中文主题",
    contentPreview: "仅预览", content: "中文第一行\n第二行完整内容 + 保留空格。", shopPhone: "+001 234 567",
    maskedPhone: null, imageCount: 1, createdAt: options.exportedAt, status: "replied", isTodo: true,
    replyCount: 1, latestReplyAdmin: "@管理员", moderationStatus: "kept", moderationCategory: "valid_feedback",
    moderationReason: "审核通过", images: [{
      id: "image-1", mediaType: "image/webp", byteSize: 321, width: 640, height: 480,
      viewUrl: "/api/studio/images/image-1", downloadUrl: "/api/studio/images/image-1?download=1",
    }], replies: [{ id: "reply-1", replyType: "message", content: "+SUM(1,2)\n完整回复中文", adminUsername: "@管理员", createdAt: options.exportedAt }],
    ...overrides,
  } as StudioFeedbackDetail;
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function readWorkbook(blob: Blob): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readBlob(blob));
  return workbook;
}

describe("Studio feedback export serialization", () => {
  it("exports real XLSX with text-safe fields, complete replies, image URLs and UTC+8 times", async () => {
    const item = fixture();
    const blob = await buildFeedbackExport([item, fixture({ id: "second-id", shopPhone: "001234" })], "xlsx", options);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const workbook = await readWorkbook(blob);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["留言与回复", "图片", "导出说明"]);
    const feedback = workbook.getWorksheet("留言与回复")!;
    expect(feedback.getCell("A2").value).toBe("000023");
    expect(feedback.getCell("B2").value).toBe(item.id);
    expect(feedback.getCell("C2").value).toBe(item.nickname);
    expect(feedback.getCell("C2").type).toBe(ExcelJS.ValueType.String);
    expect(feedback.getCell("D2").value).toBe("+001 234 567");
    expect(feedback.getCell("D3").value).toBe("001234");
    expect(feedback.getCell("D2").numFmt).toBe("@");
    expect(feedback.getCell("F2").value).toBe(item.content);
    expect(feedback.getCell("F2").alignment.wrapText).toBe(true);
    expect(feedback.getCell("G2").value).toBe("2026-09-09 09:02:03 UTC+8");
    for (const address of ["M2", "N2"]) {
      expect(feedback.getCell(address).value).toBe(1);
      expect(feedback.getCell(address).type).toBe(ExcelJS.ValueType.Number);
      expect(feedback.getCell(address).numFmt).toBe("0");
    }
    expect(feedback.getCell("Q2").value).toBe(`${options.origin}/studio/feedback/${item.id}`);
    expect(feedback.getCell("R2").value).toBe(1);
    expect(feedback.getCell("R2").numFmt).toBe("0");
    expect(feedback.getCell("S2").value).toBe(item.replies[0]!.id);
    expect(feedback.getCell("W2").value).toBe(item.replies[0]!.content);
    expect(feedback.getCell("W2").type).toBe(ExcelJS.ValueType.String);
    expect(feedback.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(feedback.autoFilter).toBe("A1:W3");
    expect(workbook.getWorksheet("回复")).toBeUndefined();
    expect(workbook.getWorksheet("图片")!.getCell("H2").value).toBe(`${options.origin}${item.images[0]!.viewUrl}`);
    for (const [address, value] of [["E2", 321], ["F2", 640], ["G2", 480]] as const) {
      const cell = workbook.getWorksheet("图片")!.getCell(address);
      expect(cell.value).toBe(value);
      expect(cell.type).toBe(ExcelJS.ValueType.Number);
      expect(cell.numFmt).toBe("0");
    }
    expect(workbook.getWorksheet("导出说明")!.getCell("B4").value).toBe(2);
    expect(workbook.getWorksheet("导出说明")!.getCell("B4").numFmt).toBe("0");
    expect(workbook.getWorksheet("导出说明")!.getCell("B5").value).toContain("不是离线图片备份");
  });

  it("keeps many replies on separate rows without exceeding the Excel cell character limit", async () => {
    const replies = Array.from({ length: 20 }, (_, index) => ({
      id: `reply-${index}`, replyType: "live" as const, content: "中".repeat(2000), adminUsername: null, createdAt: options.exportedAt,
    }));
    const workbook = await readWorkbook(await buildFeedbackExport([fixture({ replies })], "xlsx", options));
    const combined = workbook.getWorksheet("留言与回复")!;
    expect(combined.rowCount).toBe(21);
    expect(combined.getCell("A21").value).toBe("000023");
    expect(combined.getCell("B21").value).toBe(fixture().id);
    expect(combined.getCell("M2").value).toBe(20);
    expect(combined.getCell("R21").value).toBe(20);
    expect(combined.getCell("W21").value).toBe("中".repeat(2000));
  });

  it("keeps feedback without replies as one row with empty reply fields", async () => {
    const workbook = await readWorkbook(await buildFeedbackExport([
      fixture({ status: "unreplied", replies: [], replyCount: 0, latestReplyAdmin: null }),
    ], "xlsx", options));
    const combined = workbook.getWorksheet("留言与回复")!;
    expect(combined.rowCount).toBe(2);
    expect(combined.getCell("A2").value).toBe("000023");
    expect(combined.getCell("M2").value).toBe(0);
    for (const column of ["R", "S", "T", "U", "V", "W"]) expect(combined.getCell(`${column}2`).value).toBeNull();
  });

  it("exports Markdown with all content and replies while escaping user HTML and Markdown", async () => {
    const item = fixture({
      nickname: "<script>alert(1)</script>",
      content: "第一行\n# 假标题\n![跟踪](https://evil.example/a)\n<script>alert(1)</script>\n最后一行",
      replies: [
        { id: "r1", replyType: "live", content: "第一条完整回复\n---\n**原文**", adminUsername: "管理员", createdAt: options.exportedAt },
        { id: "r2", replyType: "message", content: "第二条完整回复", adminUsername: null, createdAt: options.exportedAt },
      ],
    });
    const blob = await buildFeedbackExport([item], "md", options);
    const text = new TextDecoder().decode(await readBlob(blob));
    expect(blob.type).toBe("text/markdown;charset=utf-8");
    expect(text).toContain("第一行");
    expect(text).toContain("> \\# 假标题");
    expect(text).toContain("\\!\\[跟踪\\]\\(https://evil\\.example/a\\)");
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;alert\\(1\\)&lt;/script&gt;");
    expect(text).toContain("最后一行");
    expect(text).toContain("第一条完整回复");
    expect(text).toContain("第二条完整回复");
    expect(text).toContain("\\*\\*原文\\*\\*");
    expect(text).toContain("张导小店绑定手机号");
    expect(text).toContain("\\+001 234 567");
    expect(text).toContain(`[在 Studio 查看留言](<${options.origin}/studio/feedback/${item.id}>)`);
    expect(text).toContain(`[查看](<${options.origin}${item.images[0]!.viewUrl}>)`);
    expect(text).toContain("查看或下载需要登录 Studio");
    expect(text).not.toContain("![");
    expect(text).not.toContain("仅预览");
  });

  it("supports an empty result set and absent optional phone", async () => {
    const workbook = await readWorkbook(await buildFeedbackExport([], "xlsx", options));
    for (const name of ["留言与回复", "图片"]) expect(workbook.getWorksheet(name)!.rowCount).toBe(1);
    expect(workbook.getWorksheet("导出说明")!.getCell("B4").value).toBe(0);
    const emptyMarkdown = new TextDecoder().decode(await readBlob(await buildFeedbackExport([], "md", options)));
    expect(emptyMarkdown).toContain("留言数量：0");
    const noPhone = new TextDecoder().decode(await readBlob(await buildFeedbackExport([fixture({ shopPhone: null })], "md", options)));
    expect(noPhone).toContain("- 张导小店绑定手机号：未填写");
  });

  it("rejects non-web image URLs instead of writing active Markdown links", async () => {
    const item = fixture();
    item.images[0]!.viewUrl = "javascript:alert(1)";
    await expect(buildFeedbackExport([item], "md", options)).rejects.toThrow("导出链接地址无效");
  });
});
