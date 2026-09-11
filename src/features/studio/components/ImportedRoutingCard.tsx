import { Clock, FileXls } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "../../../components/Button";
import { createRandomUuid } from "../../../lib/random-id";
import { TOPIC_LABELS } from "../../../shared/contracts";
import type { LiveImportRoutingItem } from "../../../shared/live-contracts";
import { StudioApiError } from "../api";
import { getActiveBatch, routeLiveImportRow } from "../live-api";

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(timestamp));
}

export function ImportedRoutingCard({ item, onRouted }: {
  item: LiveImportRoutingItem;
  onRouted: (message: string) => void;
}) {
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const attempt = useRef<{ batchId: string; requestKey: string; routingStatus: "selected" | "not_selected" } | null>(null);
  const route = async (routingStatus: "selected" | "not_selected") => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      if (!attempt.current || attempt.current.routingStatus !== routingStatus) {
        attempt.current = { batchId: (await getActiveBatch()).batch.id, requestKey: createRandomUuid(), routingStatus };
      }
      await routeLiveImportRow(item.jobId, item.rowNumber, attempt.current);
      onRouted(routingStatus === "selected"
        ? `Excel 第 ${item.rowNumber} 行已加入直播展示。`
        : `Excel 第 ${item.rowNumber} 行已标记为不加入直播展示。`);
    } catch (reason) {
      if (reason instanceof StudioApiError && reason.status === 409) attempt.current = null;
      setError(reason instanceof Error ? reason.message : "Excel 行分流失败，请重试");
    } finally { lock.current = false; setBusy(false); }
  };
  const title = item.topic === "other" ? item.customTopic : TOPIC_LABELS[item.topic];
  return <article className="studio-feedback-card studio-import-routing-card" data-import-row={`${item.jobId}:${item.rowNumber}`}>
    <Link className="studio-feedback-card-main" to={`/studio/imports/${item.jobId}/rows/${item.rowNumber}`} state={{ returnContext: { url: `${location.pathname}${location.search}` } }}>
      <div className="studio-card-topline">
        <span className="studio-status">Excel 待分流</span>
        <code>第 {item.rowNumber} 行</code>
      </div>
      <dl className="studio-card-fields">
        <div><dt>用户名</dt><dd>{item.nickname}</dd></div>
        <div><dt>主题</dt><dd>{title}</dd></div>
      </dl>
      <p className="studio-card-preview studio-import-routing-content">{item.content}</p>
      <div className="studio-card-meta">
        <span><FileXls aria-hidden="true" />{item.filename}</span>
        <span><Clock aria-hidden="true" />{formatDate(item.createdAt)}</span>
      </div>
    </Link>
    <div className="studio-routing-actions">
      <div className="studio-list-controls">
        <Button type="button" loading={busy} loadingLabel="正在分流" onClick={() => void route("selected")}>加入直播展示</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void route("not_selected")}>不加入直播展示</Button>
      </div>
      {error && <p role="alert" className="field-error">{error} 可点击原操作重试。</p>}
    </div>
  </article>;
}
