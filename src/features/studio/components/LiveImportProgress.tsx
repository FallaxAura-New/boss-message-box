import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "../../../components/Button";
import { createRandomUuid } from "../../../lib/random-id";
import type { LiveImportJob } from "../../../shared/live-contracts";
import { getLiveImportJob, resumeLiveImport, retryLiveImport } from "../live-api";

const STATUS = { pending: "等待分类", processing: "正在分类", failed: "分类失败" };
export function LiveImportProgress({ jobId, archived, onUpdated }: { jobId: string; archived: boolean; onUpdated: () => void }) {
  const location = useLocation();
  const [job, setJob] = useState<LiveImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const countRef = useRef(-1);
  const retryRef = useRef<{ key: string; rows: number[] } | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const { job: value } = await getLiveImportJob(jobId, signal);
    if (signal?.aborted) return;
    setJob(value); setError(null);
    const imported = value.rows.filter(r => r.status === "imported").length;
    if (countRef.current !== imported) { countRef.current = imported; onUpdated(); }
    if (!archived && value.rows.some(r => r.status === "pending" || r.status === "processing")) await resumeLiveImport(jobId);
  }, [archived, jobId, onUpdated]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      try { await refresh(controller.signal); }
      catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "任务状态加载失败，请重试"); }
      finally { if (!controller.signal.aborted && !archived) timer = window.setTimeout(() => void poll(), 4000); }
    };
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [archived, refresh]);
  const retry = async (rows: number[]) => {
    if (busy || archived) return;
    setBusy(true); setError(null);
    try {
      if (!retryRef.current || JSON.stringify(rows) !== JSON.stringify(retryRef.current.rows)) retryRef.current = { key: createRandomUuid(), rows };
      setJob((await retryLiveImport(jobId, retryRef.current.rows, retryRef.current.key)).job);
      retryRef.current = null;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "重试失败，请再次尝试"); }
    finally { setBusy(false); }
  };
  const failed = job?.rows.filter(r => r.status === "failed") ?? [];
  const classified = job?.rows.filter(r => r.status === "imported").length ?? 0;
  const awaitingRouting = job?.rows.filter(r => r.status === "imported" && r.routingStatus === "pending").length ?? 0;
  const routed = job?.rows.filter(r => r.status === "imported" && r.routingStatus !== "pending").length ?? 0;
  return <section className="studio-import-progress" aria-label="Excel 导入任务">
    <h2>导入任务{job ? ` · ${job.filename}` : ""}</h2>
    {!job && !error && <p role="status">正在读取逐行进度…</p>}
    {job && <>
      <p role="status">已分类 {classified} / {job.rows.length} 行 · 待分流 {awaitingRouting} 行 · 已分流 {routed} 行 · 失败 {failed.length} 行</p>
      {classified + failed.length === job.rows.length && <p>本次 AI 分类已完成；分类成功的行会保留在待分流。</p>}
      {archived && failed.length > 0 && <p>原批次已归档。未导入行保留失败记录；如需继续，请在当前批次重新选择文件。</p>}
      {!archived && failed.length > 0 && <Button type="button" variant="secondary" loading={busy} loadingLabel="正在重试" onClick={() => void retry(failed.map(r => r.rowNumber))}>重试失败行</Button>}
      <ol className="studio-import-rows">
        {job.rows.slice(page * 20, page * 20 + 20).map(row => <li key={row.rowNumber}>
          <Link to={`/studio/imports/${jobId}/rows/${row.rowNumber}`} state={{ returnContext: { url: `${location.pathname}${location.search}` } }}><strong>第 {row.rowNumber} 行 · {row.nickname}</strong></Link><p>{row.status === "imported"
            ? row.routingStatus === "selected" ? "已加入直播展示" : row.routingStatus === "not_selected" ? "不加入直播展示" : "等待人工分流"
            : STATUS[row.status]}{row.errorCode === "batch_archived" ? "：原批次已归档" : row.status === "failed" ? "：AI 未返回有效分类，可重试" : ""}</p>
          {row.status === "failed" && !archived && <Button type="button" variant="quiet" disabled={busy} onClick={() => void retry([row.rowNumber])}>重试第 {row.rowNumber} 行</Button>}
        </li>)}
      </ol>
      {job.rows.length > 20 && <div className="studio-list-controls">
        <Button type="button" variant="quiet" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
        <span>第 {page + 1} / {Math.ceil(job.rows.length / 20)} 页</span>
        <Button type="button" variant="quiet" disabled={(page + 1) * 20 >= job.rows.length} onClick={() => setPage(p => p + 1)}>下一页</Button>
      </div>}
    </>}
    {error && <p role="alert" className="field-error">{error} <button type="button" onClick={() => void refresh().catch(() => undefined)}>重新读取</button></p>}
  </section>;
}
