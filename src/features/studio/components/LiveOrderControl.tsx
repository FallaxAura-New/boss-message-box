import { useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

interface Props {
  nickname: string;
  position: number;
  total: number;
  disabled: boolean;
  saving: boolean;
  onMove: (position: number) => void;
}

/**
 * The queue slot: the sequence number itself is the target field, and the carets step the row
 * by one. Keeping all of it in a narrow gutter leaves the card as the only surface in the row.
 */
export function LiveOrderControl({ nickname, position, total, disabled, saving, onMove }: Props) {
  const [draft, setDraft] = useState<{ position: number; value: string } | null>(null);
  const value = draft?.position === position ? draft.value : String(position);

  const commit = () => {
    setDraft(null);
    const target = Number(value);
    if (!disabled && Number.isInteger(target) && target >= 1 && target <= total && target !== position) onMove(target);
  };

  return (
    <form
      className="studio-live-slot"
      aria-label={`${nickname}的展示顺序`}
      aria-busy={saving || undefined}
    >
      <input
        className="studio-live-slot-number"
        type="number"
        inputMode="numeric"
        min={1}
        max={total}
        step={1}
        required
        disabled={disabled}
        value={value}
        aria-label={`${nickname}的展示序号`}
        title="输入目标序号后按 Enter 移动"
        onChange={(event) => setDraft({ position, value: event.target.value })}
        onBlur={(event) => {
          // Stepping with the carets must not also commit a half-typed number.
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.form?.contains(next)) { setDraft(null); return; }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setDraft(null); return; }
          // The field sits alone in its form, so Enter is handled here rather than relying on
          // implicit submission, which needs a submit button to fire consistently.
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (event.currentTarget.checkValidity()) commit();
          else event.currentTarget.reportValidity();
        }}
      />
      <div className="studio-live-slot-moves">
        <button
          type="button"
          disabled={disabled || position === 1}
          aria-label="上移"
          title="上移"
          onClick={() => onMove(position - 1)}
        >
          <CaretUp aria-hidden="true" weight="bold" />
        </button>
        <button
          type="button"
          disabled={disabled || position === total}
          aria-label="下移"
          title="下移"
          onClick={() => onMove(position + 1)}
        >
          <CaretDown aria-hidden="true" weight="bold" />
        </button>
      </div>
      {/* The busy state rides on the group; a second live region would collide with the page notice. */}
      {saving && <span className="studio-live-slot-state" aria-hidden="true">保存中</span>}
    </form>
  );
}
