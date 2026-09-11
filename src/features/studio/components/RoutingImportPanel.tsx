import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/Button";
import type { Topic } from "../../../shared/contracts";
import type { LiveBatch, LiveImportRoutingListSuccess } from "../../../shared/live-contracts";
import { getActiveBatch, getLiveImportJobs, getLiveImportRouting } from "../live-api";
import { LiveImportControl } from "./LiveImportControl";
import { LiveImportProgress } from "./LiveImportProgress";
import { ImportedRoutingCard } from "./ImportedRoutingCard";

export function RoutingImportPanel({ topic, jobId, importPage, onQueryChange, onNotice }: {
  topic: Topic | null;
  jobId: string | null;
  importPage: number;
  onQueryChange: (key: "job" | "importPage", value: string) => void;
  onNotice: (message: string) => void;
}) {
  const [batch, setBatch] = useState<LiveBatch | null>(null);
  const [jobs, setJobs] = useState<Array<{ id: string; filename: string }>>([]);
  const [reload, setReload] = useState(0);
  const queryKey = `${topic ?? "all"}:${importPage}:${reload}`;
  const [loaded, setLoaded] = useState<{ key: string; result: LiveImportRoutingListSuccess } | null>(null);
  const result = loaded?.key === queryKey ? loaded.result : null;
  const [error, setError] = useState<string | null>(null);
  const changed = useCallback(() => setReload(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      const [{ batch: active }, routing] = await Promise.all([
        getActiveBatch(controller.signal),
        getLiveImportRouting(importPage, topic, controller.signal),
      ]);
      const jobList = await getLiveImportJobs(active.id, controller.signal);
      if (controller.signal.aborted) return;
      setBatch(active); setJobs(jobList.jobs); setLoaded({ key: queryKey, result: routing }); setError(null);
    };
    void read().catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Excel 待分流加载失败");
    });
    return () => controller.abort();
  }, [importPage, queryKey, reload, topic]);

  return <section className="studio-routing-imports" aria-labelledby="studio-import-routing-heading">
    <header className="studio-routing-section-heading">
      <div>
        <span className="studio-kicker">Excel 留言</span>
        <h2 id="studio-import-routing-heading">导入与待分流</h2>
        <p>AI 只负责主题分类；分类成功后，每一行都要在这里人工决定是否加入直播展示。</p>
      </div>
      {batch && <LiveImportControl key={batch.id} batchId={batch.id} onCreated={id => {
        onQueryChange("job", id);
        onNotice("已创建导入任务，AI 分类成功的行会出现在 Excel 待分流中。"); changed();
      }} />}
    </header>

    {jobs.length > 0 && <label className="studio-topic-filter studio-import-job-filter">导入任务
      <select aria-label="选择 Excel 导入任务" value={jobId ?? ""} onChange={event => onQueryChange("job", event.target.value)}>
        <option value="">选择任务查看进度</option>
        {jobs.map(job => <option key={job.id} value={job.id}>{job.filename} · {job.id.slice(0, 8)}</option>)}
      </select>
    </label>}
    {jobId && <LiveImportProgress key={jobId} jobId={jobId} archived={false} onUpdated={changed} />}

    <div className="studio-routing-subheading">
      <h3>Excel 待分流</h3>
      {result && <span className="studio-total">共 {result.total} 行</span>}
    </div>
    {error && <div className="studio-inline-error" role="alert"><span>{error}</span><Button type="button" variant="quiet" onClick={() => { setError(null); changed(); }}>重新加载</Button></div>}
    {!error && !result && <p role="status">正在加载 Excel 待分流…</p>}
    {!error && result?.items.length === 0 && <p className="studio-routing-empty">暂无 Excel 行等待分流。</p>}
    {!error && result && result.items.length > 0 && <div className="studio-feedback-grid">
      {result.items.map(item => <ImportedRoutingCard key={`${item.jobId}:${item.rowNumber}`} item={item} onRouted={message => {
        onNotice(message);
        const nextTotal = Math.max(0, result.total - 1);
        const nextTotalPages = Math.ceil(nextTotal / result.pageSize);
        setLoaded(current => current?.key === queryKey ? { key: current.key, result: {
          ...current.result,
          items: current.result.items.filter(candidate => candidate.jobId !== item.jobId || candidate.rowNumber !== item.rowNumber),
          total: nextTotal,
          totalPages: nextTotalPages,
        } } : current);
        if (importPage > Math.max(1, nextTotalPages)) onQueryChange("importPage", nextTotalPages ? String(nextTotalPages) : "");
        changed();
      }} />)}
    </div>}
    {result && result.totalPages > 1 && <nav className="studio-pagination" aria-label="Excel 待分流分页">
      <Button type="button" variant="quiet" disabled={importPage <= 1} onClick={() => onQueryChange("importPage", String(importPage - 1))}><ArrowLeft aria-hidden="true" />上一页</Button>
      <span>第 {importPage} / {result.totalPages} 页</span>
      <Button type="button" variant="quiet" disabled={importPage >= result.totalPages} onClick={() => onQueryChange("importPage", String(importPage + 1))}>下一页<ArrowRight aria-hidden="true" /></Button>
    </nav>}
  </section>;
}
