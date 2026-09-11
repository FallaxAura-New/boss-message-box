import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { Button } from "../../../components/Button";
import { createRandomUuid } from "../../../lib/random-id";
import { TOPIC_LABELS } from "../../../shared/contracts";
import type { LiveBatch, LiveListSuccess } from "../../../shared/live-contracts";
import { getLiveBatches, getLiveEntries, getLiveSequence, rotateLiveBatch, removeLiveEntry } from "../live-api";
import { resetLiveSequence } from "../live-sequence";
import { StudioEmpty, StudioError, StudioLoading } from "../components/AsyncState";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { StudioOutletContext } from "../components/StudioShell";

function batchTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
}
export function LiveDisplayPage() {
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const [query, setQuery] = useSearchParams();
  const navigate = useNavigate();
  const batchId = liveMode ? null : query.get("batch");
  const page = Math.max(1, Number(query.get("page")) || 1);
  const resultKey = `${batchId ?? "current"}:${page}:${liveMode}`;
  const [loaded, setLoaded] = useState<{ key: string; result: LiveListSuccess } | null>(null);
  const result = loaded?.key === resultKey ? loaded.result : null;
  const [batches, setBatches] = useState<LiveBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const rotation = useRef<{ batchId: string; key: string } | null>(null);
  const lock = useRef(false);
  const archived = result?.batch.status === "archived";
  const changed = useCallback(() => setReload(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      const value = await getLiveEntries(batchId, page, controller.signal);
      if (controller.signal.aborted) return;
      setLoaded({ key: resultKey, result: value }); setError(null);
      if (liveMode) {
        const start = await getLiveSequence(value.batch.id);
        if (!controller.signal.aborted && start.feedbackId) navigate(`/studio/feedback/${start.feedbackId}?${new URLSearchParams({ mode: "live", view: "live_display", batch: value.batch.id })}`, { replace: true });
      } else {
        const batchList = await getLiveBatches(controller.signal);
        if (!controller.signal.aborted) setBatches(batchList.batches);
      }
    };
    void read().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "直播批次加载失败"); });
    return () => controller.abort();
  }, [batchId, liveMode, navigate, page, reload, resultKey]);
  useEffect(() => {
    if (!liveMode) return;
    const timer = window.setInterval(changed, 5000);
    return () => window.clearInterval(timer);
  }, [changed, liveMode]);
  const rotate = async () => {
    if (!result || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    rotation.current ??= { batchId: result.batch.id, key: createRandomUuid() };
    try {
      await rotateLiveBatch(rotation.current.batchId, rotation.current.key);
      resetLiveSequence(); rotation.current = null; setConfirm(false);
      setQuery({}); setNotice("已归档原批次，新的直播展示组为空。历史记录仍可按刷新时间查看。"); changed();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "刷新失败，请重试"); }
    finally { lock.current = false; setBusy(false); }
  };
  const removal = useRef<{ entryId: string; batchId: string; key: string } | null>(null);
  const remove = async (entryId: string) => {
    if (!result || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      if (removal.current?.entryId !== entryId || removal.current?.batchId !== result.batch.id) removal.current = { entryId, batchId: result.batch.id, key: createRandomUuid() };
      await removeLiveEntry(entryId, result.batch.id, removal.current.key);
      removal.current = null; resetLiveSequence();
      setNotice("已取消当前批次的直播资格，原留言与回复仍保留。"); changed();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "取消失败，请重试"); }
    finally { lock.current = false; setBusy(false); }
  };
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(query); if (value) next.set(key, value); else next.delete(key);
    if (key === "batch") { next.delete("page"); next.delete("job"); next.delete("importPage"); setNotice(null); rotation.current = null; }
    setQuery(next);
  };
  return <div className="studio-page studio-live-display-page">
    <header className="studio-page-heading"><div><h1>直播展示</h1><p>{liveMode ? "只播放当前活动批次。" : "开播前按原始时间排序，开播后新选入的追加队尾；回复不会移除直播资格。"}</p></div>
      {!liveMode && <div className="studio-list-controls"><label className="studio-topic-filter">直播批次
        <select aria-label="按直播批次筛选" value={batchId ?? ""} onChange={event => setFilter("batch", event.target.value)}>
          <option value="">当前批次</option>{batches.filter(b => b.status === "archived").map(b => <option key={b.id} value={b.id}>{batchTime(b.archivedAt!)} 刷新</option>)}
        </select></label></div>}
    </header>
    {!liveMode && result && !archived && <div className="studio-list-controls studio-live-tools">
      <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm(true)}>刷新直播展示组</Button>
    </div>}
    {notice && <p role="status">{notice}</p>}
    {archived && <p role="status">已归档 · {batchTime(result!.batch.archivedAt!)} 刷新（UTC+8）。历史批次只读，不能进入当前直播。</p>}
    {error && <StudioError message={error} onRetry={() => { setError(null); changed(); }} />}
    {!result && !error && <StudioLoading label="正在加载直播批次" />}
    {result && <p className="studio-total">共 {result.total} 条</p>}
    {result?.items.length === 0 && <StudioEmpty title={archived ? "这个归档批次没有留言" : "当前直播展示组为空"} description={liveMode ? "等待工作人员从待分流加入留言，画面将自动更新。" : "请从待分流加入观众留言或已分类的 Excel 行；历史批次不会被删除。"} />}
    {result && !liveMode && <div className="studio-feedback-grid">{result.items.map(item => <article key={item.id} className="studio-feedback-card" data-feedback-id={item.id}>
      <div className="studio-feedback-card-main"><p>{item.sourceType === "imported" ? "Excel 导入" : "观众提交"} · {item.topic === "other" ? item.customTopic : TOPIC_LABELS[item.topic]}</p>
        <h2>{item.nickname}</h2><p className="studio-live-entry-content">{item.content}</p>
        <p>{item.sourceType === "imported" ? `导入于 ${batchTime(item.addedAt)} · ${item.filename} · 第 ${item.importRowNumber} 行` : `提交于 ${batchTime(item.createdAt)}`}</p>
        {item.feedbackId && <Link to={`/studio/feedback/${item.feedbackId}?view=live_display`} state={{ returnContext: { url: `/studio/live-display?${query}` } }}>查看原留言与回复</Link>}
        {item.imageCount > 0 && <p>{item.imageCount} 张图片（原留言中查看）</p>}
        {!archived && <Button type="button" variant="quiet" disabled={busy} onClick={() => void remove(item.id)}>取消直播资格</Button>}
      </div>
    </article>)}</div>}
    {!liveMode && result && result.totalPages > 1 && <nav className="studio-pagination" aria-label="直播留言分页">
      <Button type="button" variant="quiet" disabled={page <= 1} onClick={() => setFilter("page", String(page - 1))}>上一页</Button>
      <span>{page} / {result.totalPages}</span>
      <Button type="button" variant="quiet" disabled={page >= result.totalPages} onClick={() => setFilter("page", String(page + 1))}>下一页</Button>
    </nav>}
    {!liveMode && <ConfirmDialog open={confirm} title="刷新直播展示组？" description={`当前批次共 ${result?.total ?? 0} 条留言。将归档这些记录并开启空批次，直播画面会变为空。留言、回复和导入记录都不会删除。`}
      confirmLabel="归档并开启空批次" busy={busy} error={error} onCancel={() => setConfirm(false)} onConfirm={() => void rotate()} />}
  </div>;
}
