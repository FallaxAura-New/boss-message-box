import { Palette, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { closeDialog, openDialog } from "../../../lib/dialog";
import { DEFAULT_LIVE_BACKDROP, type LiveBackdrop } from "../live-backdrop";

interface LiveBackdropControlProps {
  value: LiveBackdrop;
  saved: boolean;
  onChange: (value: LiveBackdrop) => void;
}

export function LiveBackdropControl({ value, saved, onChange }: LiveBackdropControlProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) openDialog(dialog);
    if (!open && dialog.open) closeDialog(dialog);
  }, [open]);

  return (
    <>
      <button type="button" className="studio-live-action" aria-label="抠像底色" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Palette aria-hidden="true" weight="bold" /><span>底色</span>
      </button>
      <dialog
        ref={dialogRef}
        className="studio-live-backdrop-dialog"
        aria-labelledby="studio-live-backdrop-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <header>
          <h2 id="studio-live-backdrop-title">抠像底色</h2>
          <button type="button" className="studio-live-action" aria-label="关闭底色设置" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
        </header>
        <p>只替换外层背景，铭牌、留言面板和图片保持原色。</p>
        <label className="studio-live-backdrop-toggle">
          <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />
          启用纯色抠像背景
        </label>
        <div className="studio-live-backdrop-presets">
          {[{ name: "绿幕", color: "#00ff00" }, { name: "蓝幕", color: "#0000ff" }].map((preset) => (
            <button key={preset.color} type="button" aria-pressed={value.enabled && value.color === preset.color} onClick={() => onChange({ enabled: true, color: preset.color })}>
              <i aria-hidden="true" style={{ "--live-swatch": preset.color } as CSSProperties} />{preset.name}
            </button>
          ))}
        </div>
        <label className="studio-live-backdrop-color">
          <span>自定义颜色</span>
          <input type="color" value={value.color} onInput={(event) => onChange({ enabled: true, color: event.currentTarget.value.toLowerCase() })} />
          <output>{value.color.toUpperCase()}</output>
        </label>
        <p>选择与文字、图片不同的颜色；设置好后关闭此面板再采集。</p>
        {!saved && <p role="status">当前页面已生效，但浏览器未允许保存设置。</p>}
        <footer>
          <button type="button" onClick={() => onChange({ ...DEFAULT_LIVE_BACKDROP })}>恢复原背景</button>
          <button type="button" onClick={() => setOpen(false)}>完成</button>
        </footer>
      </dialog>
    </>
  );
}
