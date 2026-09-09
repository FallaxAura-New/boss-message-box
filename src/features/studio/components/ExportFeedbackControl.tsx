import { DownloadSimple, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Topic } from "../../../shared/contracts";
import { TOPIC_LABELS } from "../../../shared/contracts";
import type { StudioFeedbackView, StudioSnapshot } from "../../../shared/studio-contracts";
import { Button } from "../../../components/Button";
import { closeDialog, openDialog } from "../../../lib/dialog";
import { collectStudioExport } from "../collect-export";

interface Props {
  view: StudioFeedbackView;
  topic: Topic | null;
  snapshot: StudioSnapshot | null;
  title: string;
}

export function ExportFeedbackControl({ view, topic, snapshot, title }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [scope, setScope] = useState("current");
  const [format, setFormat] = useState<"xlsx" | "md">("xlsx");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentLabel = `${title} · ${topic ? TOPIC_LABELS[topic] : "全部主题"}`;

  useEffect(() => () => controller.current?.abort(), []);
  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    if (ref.current?.open) closeDialog(ref.current);
    trigger.current?.focus();
  };
  const start = async () => {
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setProgress(0);
    setError(null);
    setMessage(null);
    const scopeLabel = scope === "all" ? "全部留言（含 AI 已过滤）" : currentLabel;
    try {
      const items = await collectStudioExport({
        view: scope === "all" ? "all" : view,
        topic: scope === "all" ? null : topic,
        snapshot: scope === "all" ? null : snapshot,
      }, request.signal, setProgress);
      if (!items.length) {
        setMessage("这个范围没有留言，可以更换导出范围。");
        return;
      }
      const { buildFeedbackExport } = await import("../export-files");
      request.signal.throwIfAborted();
      const exportedAt = Date.now();
      const blob = await buildFeedbackExport(items, format, { scopeLabel, exportedAt, origin: window.location.origin });
      request.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `张导留言_${scope === "all" ? "全部" : title}_${new Date(exportedAt + 8 * 3600_000).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setMessage(`已生成 ${items.length} 条留言的 ${format === "xlsx" ? "Excel" : "Markdown"} 文件，并发起下载。`);
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : "导出失败，请重试");
    } finally {
      if (controller.current === request) {
        setBusy(false);
        controller.current = null;
      }
    }
  };

  return <>
    <button ref={trigger} type="button" className="button button--secondary studio-export-trigger"
      onClick={() => { setError(null); setMessage(null); if (ref.current) openDialog(ref.current); }}>
      <DownloadSimple aria-hidden="true" /><span>导出留言</span>
    </button>
    <dialog ref={ref} className="studio-confirm-dialog studio-export-dialog" aria-labelledby="studio-export-title"
      onCancel={event => { event.preventDefault(); cancel(); }} onClose={() => trigger.current?.focus()}>
      <div className="studio-confirm-header">
        <h2 id="studio-export-title">导出留言</h2>
        <button type="button" className="studio-icon-button" aria-label="关闭导出" onClick={cancel}><X aria-hidden="true" /></button>
      </div>
      <div className="studio-export-fields">
        <label>导出范围
          <select value={scope} disabled={busy} onChange={event => setScope(event.target.value)}>
            <option value="current">当前分类与主题的全部页</option>
            <option value="all">全部留言（含 AI 已过滤）</option>
          </select>
        </label>
        <p>{scope === "current" ? currentLabel : "不限制分类和主题，包含已过滤留言。"}</p>
        <label>文件格式
          <select value={format} disabled={busy} onChange={event => setFormat(event.target.value as "xlsx" | "md")}>
            <option value="xlsx">Excel（.xlsx）</option>
            <option value="md">Markdown（.md）</option>
          </select>
        </label>
        <p>{format === "xlsx" ? "适合筛选、分类和统计；留言、回复与图片链接分表整理。" : "适合连续阅读、整理文档和知识库。"}</p>
        <p>包含完整正文、全部回复及小店绑定手机号。图片导出为链接，查看时需登录 Studio。</p>
        {busy && <p role="status">已读取 {progress} 条，正在准备文件…</p>}
        {message && <p role="status">{message}</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
      <div className="studio-confirm-actions">
        <Button type="button" variant="quiet" onClick={cancel}>{busy ? "取消导出" : "关闭"}</Button>
        <Button type="button" loading={busy} loadingLabel="正在导出" onClick={() => void start()}>开始导出</Button>
      </div>
    </dialog>
  </>;
}
