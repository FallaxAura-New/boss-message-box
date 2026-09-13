import { ChatCircleText, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/Button";
import type { StudioReply } from "../../../shared/studio-contracts";
import { ConfirmDialog } from "./ConfirmDialog";

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
});

export function ReplyHistory({ replies, disabled, onDelete }: {
  replies: StudioReply[];
  disabled: boolean;
  onDelete: (replyId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<StudioReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (notice && !selected) titleRef.current?.focus();
  }, [notice, selected]);

  const confirm = async () => {
    if (!selected || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onDelete(selected.id);
      setSelected(null);
      setNotice("回复已删除，原始留言保持不变。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败，请重试");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="studio-detail-section" aria-labelledby="studio-replies-title">
      <div className="studio-section-title"><span id="studio-replies-title" ref={titleRef} tabIndex={-1}>历史回复</span><small>{replies.length} 条</small></div>
      {notice && <p className="studio-reply-notice" role="status">{notice}</p>}
      {replies.length === 0 ? <p className="studio-inline-empty">还没有回复。</p> : (
        <ol className="studio-reply-history">
          {replies.map((reply, index) => (
            <li key={reply.id}>
              <div className="studio-reply-body">
                <span className="studio-reply-kind"><ChatCircleText aria-hidden="true" />{reply.replyType === "live" ? "直播回复" : "留言回复"}</span>
                <p>{reply.content}</p>
                <small>回复人：{reply.adminUsername ?? "历史回复"}</small>
              </div>
              <div className="studio-reply-meta">
                <time dateTime={new Date(reply.createdAt).toISOString()}>{dateFormat.format(reply.createdAt)}</time>
                <Button type="button" variant="quiet" className="studio-reply-delete" icon={<Trash aria-hidden="true" />}
                  aria-label={`删除第 ${index + 1} 条回复`} disabled={disabled || busy}
                  onClick={() => { setSelected(reply); setError(null); setNotice(null); }}>
                  删除回复
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <ConfirmDialog open={selected !== null} title="删除这条回复？" danger
        description="只删除这条回复，不修改观众的原始留言。删除后无法恢复；如果这是最后一条回复，留言将不再归为已回复。"
        confirmLabel="确认删除" busy={busy} error={error}
        onCancel={() => setSelected(null)} onConfirm={() => void confirm()} />
    </section>
  );
}
