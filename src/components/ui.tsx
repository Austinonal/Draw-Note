import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Sheet({ title, onClose, children, wide, actions }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"sheet" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <div className="sheet-actions">
            {actions}
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** A floating panel anchored near the top bar (tablets) or as a bottom sheet (phones). */
export function Panel({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="panel" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
      <div className="panel-head">
        <h3>{title}</h3>
        <div className="sheet-actions">
          {actions}
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

/** A vertical slider like ProCraft's sidebar (size / opacity). */
export function VSlider({ value, onChange, label, display }: { value: number; onChange: (v: number) => void; label: string; display?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height)));
  };
  return (
    <div
      className="vslider"
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e.clientY);
      }}
      onPointerMove={(e) => e.buttons && set(e.clientY)}
    >
      <div className="vslider-fill" style={{ height: `${value * 100}%` }} />
      <div className="vslider-label">{display ?? Math.round(value * 100) + "%"}</div>
    </div>
  );
}

export function Range({ label, value, min, max, step = 1, onChange, suffix = "", onCommit }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; onCommit?: () => void }) {
  return (
    <label className="range">
      <span className="range-label">
        {label}
        <b>
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}
          {suffix}
        </b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} />
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.id} className={o.id === value ? "on" : ""} title={o.title} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Asked after importing a PDF; the choice can be switched later in Actions. */
export function PdfModeSheet({ onPick, onClose }: { onPick: (editable: boolean) => void; onClose: () => void }) {
  return (
    <Sheet title="How do you want to use this PDF?" onClose={onClose}>
      <div className="create-grid">
        <button onClick={() => onPick(false)}>
          <b>Read &amp; write</b>
          <small>Read it and add handwriting, highlights and notes on top. The PDF itself stays as it is.</small>
        </button>
        <button onClick={() => onPick(true)}>
          <b>Read, write &amp; edit the PDF</b>
          <small>Also tap the PDF&apos;s text to change it in place, drag lines to move them, and lift out pictures or tables.</small>
        </button>
      </div>
      <p className="hint">You can switch this any time in Actions (🔧) → &ldquo;Edit PDF text &amp; elements&rdquo;.</p>
    </Sheet>
  );
}

export function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1600);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  return <div className="toast">{msg}</div>;
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = accept;
    i.multiple = multiple;
    i.onchange = () => resolve(i.files ? [...i.files] : []);
    i.click();
  });
}

export async function shareOrDownload(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch {
      /* fall back to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readAsDataUrl(f: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

export function safeName(s: string): string {
  return (s.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
}
