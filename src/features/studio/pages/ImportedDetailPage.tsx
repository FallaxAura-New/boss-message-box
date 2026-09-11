import { ArrowLeft, Clock, FileXls, UserCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { TOPIC_LABELS, type Topic } from "../../../shared/contracts";
import { StudioError, StudioLoading } from "../components/AsyncState";
import type { StudioOutletContext } from "../components/StudioShell";
import { getLiveEntry, getLiveImportJob } from "../live-api";
import type { StudioReturnContext } from "../navigation-context";

interface ImportedDetail {
  nickname: string; content: string; topic: Topic | null; customTopic: string | null;
  filename: string; rowNumber: number; createdAt: number; status: string;
}
const formatDate = (time: number) => new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(time);

export function ImportedDetailPage() {
  const { entryId, jobId, rowNumber } = useParams();
  const [query] = useSearchParams();
  const batchId = query.get("batch");
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const location = useLocation();
  const returnContext = (location.state as { returnContext?: StudioReturnContext } | null)?.returnContext;
  const fallback = entryId ? `/studio/live-display${batchId ? `?batch=${encodeURIComponent(batchId)}` : ""}` : `/studio/routing?job=${encodeURIComponent(jobId ?? "")}`;
  const back = returnContext?.url.startsWith("/studio/") ? returnContext.url : fallback;
  const key = `${entryId}:${batchId}:${jobId}:${rowNumber}`;
  const [loaded, setLoaded] = useState<{ key: string; item: ImportedDetail } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const item = loaded?.key === key ? loaded.item : null;
  const error = failure?.key === key ? failure.message : null;

  useEffect(() => {
    if (liveMode) return;
    const controller = new AbortController();
    const read = async (): Promise<ImportedDetail> => {
      if (entryId && batchId) {
        const { item: entry } = await getLiveEntry(entryId, batchId, controller.signal);
        if (entry.sourceType !== "imported") throw new Error("这条记录不是 Excel 导入留言");
        return { ...entry, filename: entry.filename ?? "Excel 导入", rowNumber: entry.importRowNumber ?? entry.importOrder, status: "直播展示记录" };
      }
      if (!jobId || !rowNumber || !Number.isInteger(Number(rowNumber))) throw new Error("导入留言地址无效");
      const { job } = await getLiveImportJob(jobId, controller.signal);
      const row = job.rows.find(value => value.rowNumber === Number(rowNumber));
      if (!row) throw new Error("这条导入留言不存在");
      const status = row.status === "imported"
        ? ({ pending: "待分流", selected: "已加入直播展示", not_selected: "不加入直播展示" }[row.routingStatus ?? "pending"])
        : { pending: "等待分类", processing: "正在分类", failed: "分类失败" }[row.status];
      return { ...row, filename: job.filename, createdAt: job.createdAt, status };
    };
    void read().then(value => {
      if (!controller.signal.aborted) { setLoaded({ key, item: value }); setFailure(null); }
    }).catch(reason => {
      if (!controller.signal.aborted) setFailure({ key, message: reason instanceof Error ? reason.message : "导入留言加载失败" });
    });
    return () => controller.abort();
  }, [batchId, entryId, jobId, key, liveMode, reload, rowNumber]);

  if (liveMode) return <Navigate to="/studio/live-display?mode=live" replace />;
  return <div className="studio-page studio-detail-page studio-import-detail-page">
    <header className="studio-detail-heading">
      <Link className="studio-back-button" to={back} state={{ restoreContext: returnContext }}><ArrowLeft aria-hidden="true" />返回列表</Link>
      <span className="studio-status">Excel 导入{item ? ` · ${item.status}` : ""}</span>
    </header>
    {error ? <StudioError message={error} onRetry={() => { setFailure(null); setReload(value => value + 1); }} /> : !item ? <StudioLoading label="正在加载导入留言" /> :
      <article className="studio-feedback-detail">
        <div className="studio-detail-identity"><div><span>用户名</span><strong><UserCircle aria-hidden="true" />{item.nickname}</strong></div></div>
        <div className="studio-detail-section"><span>主题</span><h1>{item.topic ? item.topic === "other" ? item.customTopic || "其他" : TOPIC_LABELS[item.topic] : "等待分类"}</h1></div>
        <div className="studio-detail-section"><span>留言正文</span><p className="studio-detail-content">{item.content}</p></div>
        <div className="studio-detail-section"><span>来源文件</span><p><FileXls aria-hidden="true" /> {item.filename} · 第 {item.rowNumber} 行</p></div>
        <div className="studio-detail-section studio-submitted-time"><span>导入时间（UTC+8）</span><strong><Clock aria-hidden="true" />{formatDate(item.createdAt)}</strong></div>
      </article>}
  </div>;
}
