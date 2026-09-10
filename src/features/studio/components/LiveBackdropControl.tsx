import { Palette, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { closeDialog, openDialog } from "../../../lib/dialog";
import { DEFAULT_LIVE_BACKDROP, type LiveBackdrop } from "../live-backdrop";

interface LiveBackdropControlProps {
  value: LiveBackdrop;
  saved: boolean;
  onChange: (value: LiveBackdrop) => void;
  chromePinned: boolean;
  onChromePinnedChange: (pinned: boolean) => void;
}

export function LiveBackdropControl({
  value,
  saved,
  onChange,
  chromePinned,
  onChromePinnedChange,
}: LiveBackdropControlProps) {
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
      <button type="button" className="studio-live-action" aria-label="直播画面设置" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Palette aria-hidden="true" weight="bold" /><span>画面</span>
      </button>
      <dialog
        ref={dialogRef}
        className="studio-live-backdrop-dialog"
        aria-labelledby="studio-live-settings-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <header>
          <h2 id="studio-live-settings-title">直播画面设置</h2>
          <button type="button" className="studio-live-action" aria-label="关闭画面设置" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
        </header>

        <section className="studio-live-settings-group">
          <h3>抠像底色</h3>
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
        </section>

        <section className="studio-live-settings-group">
          <h3>操作按钮</h3>
          <p>空闲三秒后自动淡出，避免「画面 / 全屏 / 退出」被一起播出去；移动鼠标、点按或按非方向键会重新显示。</p>
          <label className="studio-live-backdrop-toggle">
            <input type="checkbox" checked={chromePinned} onChange={(event) => onChromePinnedChange(event.target.checked)} />
            始终显示操作按钮
          </label>
        </section>

        {!saved && <p role="status">当前页面已生效，但浏览器未允许保存设置。</p>}
        <footer>
          <button type="button" onClick={() => onChange({ ...DEFAULT_LIVE_BACKDROP })}>恢复原背景</button>
          <button type="button" onClick={() => setOpen(false)}>完成</button>
        </footer>
      </dialog>
    </>
  );
}
