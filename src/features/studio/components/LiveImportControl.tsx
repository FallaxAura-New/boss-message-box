import { useRef, useState } from "react";
import { Button } from "../../../components/Button";
import { closeDialog, openDialog } from "../../../lib/dialog";
import { createRandomUuid } from "../../../lib/random-id";
import type { LiveImportInput } from "../../../shared/live-contracts";
import { createLiveImport } from "../live-api";
import type { ImportPreview } from "../import-xlsx";

export function LiveImportControl({ batchId, onCreated }: { batchId: string; onCreated: (jobId: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const attempt = useRef<LiveImportInput | null>(null);
  const originalFile = useRef<File | null>(null);
  const lock = useRef(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const close = () => { if (dialog.current) closeDialog(dialog.current); trigger.current?.focus(); };
  const parse = async (file?: File) => {
    if (!file || lock.current) return;
    lock.current = true; setBusy(true); setError(null); setPreview(null); setPage(0); attempt.current = null;
    originalFile.current = null;
    try {
      const { parseLiveWorkbook } = await import("../import-xlsx");
      setPreview(await parseLiveWorkbook(file));
      originalFile.current = file;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取工作簿，请检查格式后重试"); }
    finally { lock.current = false; setBusy(false); }
  };
  const confirm = async () => {
    if (!preview?.rows.length || !originalFile.current || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      attempt.current ??= { jobId: createRandomUuid(), batchId, fileHash: preview.fileHash, filename: preview.filename, fileSize: preview.fileSize, rows: preview.rows };
      const { job } = await createLiveImport(attempt.current, originalFile.current);
      onCreated(job.id); close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导入任务创建失败，请重试"); }
    finally { lock.current = false; setBusy(false); }
  };
  const reviewRows = preview ? [
    ...preview.rows.map(r => ({ rowNumber: r.rowNumber, text: `${r.nickname}：${r.content}`, valid: true })),
    ...preview.invalidRows.map(r => ({ rowNumber: r.rowNumber, text: r.reason, valid: false })),
  ].sort((a, b) => a.rowNumber - b.rowNumber) : [];
  return <>
    <button ref={trigger} type="button" className="button button--secondary" onClick={() => { if (dialog.current) openDialog(dialog.current); }}>导入 Excel</button>
    <dialog ref={dialog} className="studio-confirm-dialog studio-import-dialog" aria-labelledby="live-import-title"
      onCancel={event => { event.preventDefault(); if (!busy) close(); }} onClose={() => trigger.current?.focus()}>
      <div className="studio-confirm-header"><h2 id="live-import-title">导入 Excel 留言</h2></div>
      <div className="studio-export-fields studio-import-body">
        <p id="live-import-help">只读取第一张工作表的“用户名”和“用户留言”。上限 2 MiB、500 行；用户名 40 字符、留言 2000 字符，不会截断。</p>
        <label>选择工作簿<input type="file" accept=".xlsx" disabled={busy} aria-describedby="live-import-help"
          onChange={event => void parse(event.target.files?.[0])} /></label>
        {busy && <p role="status">正在处理，请稍候…</p>}
        {preview && <>
          <p role="status">有效 {preview.rows.length} 行 · 无效 {preview.invalidRows.length} 行 · 空白 {preview.emptyRows} 行</p>
          <p>确认后只提交有效行。AI 分类成功后进入待分流；只有人工选择“加入直播展示”才会进入当前批次，不进入未回复或公开历史。</p>
          <ol className="studio-import-rows">
            {reviewRows.slice(page * 20, page * 20 + 20).map(r => <li key={r.rowNumber}>
              <strong>Excel 第 {r.rowNumber} 行 · {r.valid ? "有效" : "无效，不导入"}</strong><p>{r.text}</p>
            </li>)}
          </ol>
          {reviewRows.length > 20 && <div className="studio-list-controls">
            <Button type="button" variant="quiet" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <span>{page + 1} / {Math.ceil(reviewRows.length / 20)}</span>
            <Button type="button" variant="quiet" disabled={(page + 1) * 20 >= reviewRows.length} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>}
          {!preview.rows.length && <p>没有有效行，请修正文件后重新选择。</p>}
        </>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
      <div className="studio-confirm-actions">
        <Button type="button" variant="quiet" disabled={busy} onClick={close}>取消</Button>
        <Button type="button" disabled={!preview?.rows.length} loading={busy} loadingLabel="正在处理" onClick={() => void confirm()}>确认导入有效行</Button>
      </div>
    </dialog>
  </>;
}
