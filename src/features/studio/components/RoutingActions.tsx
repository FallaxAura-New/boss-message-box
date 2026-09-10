import { useRef, useState } from "react";
import { Button } from "../../../components/Button";
import { createRandomUuid } from "../../../lib/random-id";
import { getActiveBatch, routeLiveFeedback } from "../live-api";
import { StudioApiError } from "../api";

export function RoutingActions({ feedbackId, onRouted }: { feedbackId: string; onRouted: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ batchId: string; requestKey: string; routingStatus: "selected" | "not_selected" } | null>(null);
  const lock = useRef(false);
  const route = async (routingStatus: "selected" | "not_selected") => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(null);
    try {
      if (!attempt.current || attempt.current.routingStatus !== routingStatus) {
        attempt.current = { batchId: (await getActiveBatch()).batch.id, requestKey: createRandomUuid(), routingStatus };
      }
      await routeLiveFeedback(feedbackId, attempt.current);
      onRouted(routingStatus === "selected" ? "已加入直播展示，同时进入未回复列表。" : "已分流至未回复列表，不加入直播展示。");
    } catch (reason) {
      // A definite conflict is safe to restart against the current batch. Network
      // failures keep the original key so an uncertain success cannot be duplicated.
      if (reason instanceof StudioApiError && reason.status === 409) attempt.current = null;
      setError(reason instanceof Error ? reason.message : "分流失败，请重试");
    } finally { lock.current = false; setBusy(false); }
  };
  return <div className="studio-routing-actions">
    <div className="studio-list-controls">
      <Button type="button" loading={busy} loadingLabel="正在分流" onClick={() => void route("selected")}>加入直播展示</Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void route("not_selected")}>不加入直播展示</Button>
    </div>
    {error && <p role="alert" className="field-error">{error} 可点击原操作重试。</p>}
  </div>;
}
