import { useState } from "react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { Button } from "../../../components/Button";

interface Props {
  nickname: string;
  position: number;
  total: number;
  disabled: boolean;
  saving: boolean;
  onMove: (position: number) => void;
}

export function LiveOrderControl({ nickname, position, total, disabled, saving, onMove }: Props) {
  const [draft, setDraft] = useState({ position, value: String(position) });
  const value = draft.position === position ? draft.value : String(position);
  return <form className="studio-live-order" aria-label={`${nickname}的展示顺序`} onSubmit={event => {
    event.preventDefault();
    const target = Number(value);
    if (!disabled && Number.isInteger(target) && target >= 1 && target <= total && target !== position) onMove(target);
  }}>
    <span className="studio-live-position">第 {position} 条</span>
    <div className="studio-live-order-actions">
      <Button type="button" variant="secondary" icon={<ArrowUp aria-hidden="true" />} disabled={disabled || position === 1} onClick={() => onMove(position - 1)}>上移</Button>
      <Button type="button" variant="secondary" icon={<ArrowDown aria-hidden="true" />} disabled={disabled || position === total} onClick={() => onMove(position + 1)}>下移</Button>
    </div>
    <div className="studio-live-order-target">
      <label>移到第 <input type="number" inputMode="numeric" min={1} max={total} step={1} required
        aria-label={`${nickname}的目标序号`} value={value} disabled={disabled}
        onChange={event => setDraft({ position, value: event.target.value })} /> 条</label>
      <Button type="submit" variant="quiet" disabled={disabled || Number(value) === position} loading={saving} loadingLabel="保存中">移动</Button>
    </div>
  </form>;
}
