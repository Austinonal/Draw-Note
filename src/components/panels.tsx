// Editor panels: Layers, Brush library + Brush Studio, Adjustments, Pages, Time-lapse.
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Lock, Unlock, Plus, Copy, Trash2, ArrowUp, ArrowDown, Combine, Bookmark, Play, Pause, Download, RotateCcw } from "lucide-react";
import { BLENDS, type Layer } from "../lib/model";
import { BRUSHES, BRUSH_SETS, STUDIO_FIELDS, type Brush, type Grain, type TipShape } from "../paint/brushes";
import { brushPreview } from "../paint/engine";
import { ADJUSTMENTS, GRADIENT_PRESETS, applyAdjust, defaults, type AdjustDef } from "../paint/adjust";
import type { Workspace } from "../editor/workspace";
import { Range, Seg, Toggle, shareOrDownload, safeName } from "./ui";
import { pageToCanvas } from "../lib/render";

// ------------------------------------------------------------------ Layers
export function LayersPanel({ ws, tick }: { ws: Workspace; tick: number }) {
  const p = ws.page;
  const [open, setOpen] = useState<string | null>(null);
  const thumbs = useMemo(() => Object.fromEntries(p.layers.map((l) => [l.id, ws.layerThumb(l.id, 56)])), [ws, p, tick, p.layers.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const layers = [...p.layers].reverse();
  return (
    <div className="layers">
      <div className="row gap">
        <button className="btn" onClick={() => ws.addLayer()}>
          <Plus size={16} /> Layer
        </button>
        <button className={"btn" + (p.notesVisible ? "" : " dim")} onClick={() => ((p.notesVisible = !p.notesVisible), ws.invalidateNotes(), ws.markDocDirty())}>
          {p.notesVisible ? <Eye size={16} /> : <EyeOff size={16} />} Notes layer
        </button>
      </div>
      <div className="layer notes-layer">
        <div className="layer-thumb notes">✍️</div>
        <div className="layer-name">
          Notes (ink, text, shapes)
          <small>{p.objects.length} objects · always on top</small>
        </div>
      </div>
      {layers.map((l) => (
        <LayerRow key={l.id} l={l} ws={ws} thumb={thumbs[l.id]} active={l.id === p.activeLayer} open={open === l.id} toggle={() => setOpen(open === l.id ? null : l.id)} index={p.layers.indexOf(l)} />
      ))}
      <div className="layer bg-layer">
        <div className="layer-thumb" style={{ background: p.paperColor }} />
        <div className="layer-name">
          Background / paper
          <small>
            <input type="color" value={p.paperColor} onChange={(e) => ((p.paperColor = e.target.value), ws.request(), ws.markDocDirty())} />
          </small>
        </div>
      </div>
    </div>
  );
}

function LayerRow({ l, ws, thumb, active, open, toggle, index }: { l: Layer; ws: Workspace; thumb: string; active: boolean; open: boolean; toggle: () => void; index: number }) {
  const blend = BLENDS.find((b) => b.id === l.blend);
  return (
    <div className={"layer" + (active ? " active" : "") + (l.clip ? " clipped" : "")}>
      <div className="layer-main" onClick={() => (active ? toggle() : ws.selectLayer(l.id))}>
        <div className="layer-thumb checker">{thumb && <img src={thumb} alt="" />}</div>
        <div className="layer-name">
          {l.name}
          <small>
            {blend?.short} · {Math.round(l.opacity * 100)}%{l.alphaLock ? " · α" : ""}
            {l.clip ? " · clip" : ""}
          </small>
        </div>
        <button className="icon-btn sm" onClick={(e) => (e.stopPropagation(), ws.setLayer(l.id, { visible: !l.visible }, false))} aria-label="Visibility">
          {l.visible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>
      {open && (
        <div className="layer-opts">
          <input className="name-input" value={l.name} onChange={(e) => ws.setLayer(l.id, { name: e.target.value }, false)} />
          <Range label="Opacity" value={l.opacity * 100} min={0} max={100} onChange={(v) => ws.setLayer(l.id, { opacity: v / 100 }, false)} suffix="%" />
          <select value={l.blend} onChange={(e) => ws.setLayer(l.id, { blend: e.target.value as Layer["blend"] })}>
            {BLENDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <div className="chips">
            <button className={l.alphaLock ? "on" : ""} onClick={() => ws.setLayer(l.id, { alphaLock: !l.alphaLock })}>
              Alpha lock
            </button>
            <button className={l.clip ? "on" : ""} disabled={index === 0} onClick={() => ws.setLayer(l.id, { clip: !l.clip })}>
              Clipping mask
            </button>
            <button className={l.locked ? "on" : ""} onClick={() => ws.setLayer(l.id, { locked: !l.locked })}>
              {l.locked ? <Lock size={14} /> : <Unlock size={14} />} Lock
            </button>
          </div>
          <div className="chips">
            <button onClick={() => ws.duplicateLayer(l.id)}>
              <Copy size={14} /> Duplicate
            </button>
            <button disabled={index === 0} onClick={() => ws.mergeDown(l.id)}>
              <Combine size={14} /> Merge down
            </button>
            <button onClick={() => ws.moveLayer(l.id, 1)}>
              <ArrowUp size={14} />
            </button>
            <button onClick={() => ws.moveLayer(l.id, -1)}>
              <ArrowDown size={14} />
            </button>
            <button className="danger" onClick={() => ws.deleteLayer(l.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="chips">
            <button onClick={() => ws.copyToNewLayer(false)}>Copy selection → layer</button>
            <button onClick={() => ws.clearSelected()}>Clear</button>
            <button onClick={() => ws.fillSelected()}>Fill with colour</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Brushes
function Preview({ brush, color }: { brush: Brush; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // render at the element's real pixel size so previews are sharp on high-DPI screens
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round((el.clientWidth || 300) * dpr);
    const c = brushPreview({ ...brush, minSize: brush.minSize * dpr, maxSize: brush.maxSize * dpr }, w, Math.round(el.clientHeight * dpr || 56 * dpr), color);
    c.className = "brush-stroke";
    el.replaceChildren(c);
  }, [brush, color]);
  return <div ref={ref} className="brush-preview" />;
}

export function BrushPanel({ current, onPick, color, custom, setCustom }: { current: string; onPick: (id: string) => void; color: string; custom: Brush[]; setCustom: (b: Brush[]) => void }) {
  const all = [...BRUSHES, ...custom];
  const cur = all.find((b) => b.id === current) ?? BRUSHES[0];
  const [set, setSet] = useState<string>(cur.set);
  const [studio, setStudio] = useState(false);
  const sets = [...BRUSH_SETS, ...(custom.length ? ["My Brushes"] : [])];
  const list = all.filter((b) => (set === "My Brushes" ? custom.includes(b) : b.set === set));
  if (studio) return <BrushStudio brush={cur} color={color} onBack={() => setStudio(false)} custom={custom} setCustom={setCustom} onPick={onPick} />;
  return (
    <div className="brushes">
      <div className="brush-sets">
        {sets.map((s) => (
          <button key={s} className={s === set ? "on" : ""} onClick={() => setSet(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="brush-list">
        {list.map((b) => (
          <button key={b.id} className={"brush-item" + (b.id === current ? " on" : "")} onClick={() => (b.id === current ? setStudio(true) : onPick(b.id))}>
            <span>{b.name}</span>
            <Preview brush={b} color={color} />
          </button>
        ))}
        <p className="hint">Tap the selected brush again to open the Brush Studio.</p>
      </div>
    </div>
  );
}

function BrushStudio({ brush, color, onBack, custom, setCustom, onPick }: { brush: Brush; color: string; onBack: () => void; custom: Brush[]; setCustom: (b: Brush[]) => void; onPick: (id: string) => void }) {
  const [b, setB] = useState<Brush>({ ...brush });
  const groups = [...new Set(STUDIO_FIELDS.map((f) => f.group))];
  const [group, setGroup] = useState(groups[0]);
  const isCustom = custom.some((c) => c.id === brush.id);
  const save = () => {
    if (isCustom) setCustom(custom.map((c) => (c.id === b.id ? b : c)));
    else {
      const nb = { ...b, id: "custom-" + Date.now().toString(36), set: "My Brushes", name: b.name === brush.name ? b.name + " (custom)" : b.name };
      setCustom([...custom, nb]);
      onPick(nb.id);
    }
    onBack();
  };
  return (
    <div className="studio">
      <div className="row gap">
        <button className="btn" onClick={onBack}>
          ← Library
        </button>
        <input className="name-input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />
        <button className="btn primary" onClick={save}>
          {isCustom ? "Save" : "Save as new"}
        </button>
      </div>
      <div className="drawing-pad">
        <Preview brush={b} color={color} />
      </div>
      <div className="brush-sets">
        {groups.map((g) => (
          <button key={g} className={g === group ? "on" : ""} onClick={() => setGroup(g)}>
            {g}
          </button>
        ))}
      </div>
      {group === "Shape" && (
        <select value={b.shape} onChange={(e) => setB({ ...b, shape: e.target.value as TipShape })}>
          {(["round", "square", "flat", "spray", "splatter", "leaf", "star"] as TipShape[]).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      {group === "Shape" && <Toggle label="Tip follows stroke direction" checked={b.followStroke} onChange={(v) => setB({ ...b, followStroke: v })} />}
      {group === "Grain" && (
        <select value={b.grain} onChange={(e) => setB({ ...b, grain: e.target.value as Grain })}>
          {(["none", "paper", "canvas", "noise", "charcoal", "streaks"] as Grain[]).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      {STUDIO_FIELDS.filter((f) => f.group === group).map((f) => (
        <Range key={f.key} label={f.label} value={b[f.key] as number} min={f.min} max={f.max} step={f.step} onChange={(v) => setB({ ...b, [f.key]: v })} />
      ))}
      <div className="row gap">
        <button className="btn" onClick={() => setB({ ...brush })}>
          <RotateCcw size={14} /> Reset
        </button>
        {isCustom && (
          <button
            className="btn danger"
            onClick={() => {
              setCustom(custom.filter((c) => c.id !== brush.id));
              onPick(BRUSHES[0].id);
              onBack();
            }}
          >
            Delete brush
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Adjustments
export function AdjustPanel({ ws, onDone }: { ws: Workspace; onDone: () => void }) {
  const [def, setDef] = useState<AdjustDef | null>(null);
  const [vals, setVals] = useState<Record<string, number>>({});
  const timer = useRef(0);
  useEffect(() => () => ws.previewAdjustment(null), [ws]);
  useEffect(() => {
    if (!def) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => ws.previewAdjustment((img) => applyAdjust(img, def.id, scaleParams(def, vals, 1100 / Math.max(ws.rw, ws.rh)))), 60);
  }, [def, vals, ws]);
  if (!def)
    return (
      <div className="adjust-list">
        <p className="hint">Applies to the active paint layer{ws.selection ? " inside the selection" : ""}.</p>
        {ADJUSTMENTS.map((a) => (
          <button
            key={a.id}
            onClick={() => {
              setDef(a);
              setVals(defaults(a));
            }}
          >
            {a.name}
          </button>
        ))}
      </div>
    );
  return (
    <div className="adjust">
      <h4>{def.name}</h4>
      {def.params.map((p) =>
        def.id === "gradientMap" && p.key === "preset" ? (
          <select key={p.key} value={vals.preset} onChange={(e) => setVals({ ...vals, preset: Number(e.target.value) })}>
            {GRADIENT_PRESETS.map((g, i) => (
              <option key={g.name} value={i}>
                {g.name}
              </option>
            ))}
          </select>
        ) : (
          <Range key={p.key} label={p.label} value={vals[p.key]} min={p.min} max={p.max} step={p.step} onChange={(v) => setVals({ ...vals, [p.key]: v })} />
        ),
      )}
      <div className="row gap">
        <button
          className="btn"
          onClick={() => {
            ws.previewAdjustment(null);
            setDef(null);
          }}
        >
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            const d = def;
            ws.applyAdjustment((img) => applyAdjust(img, d.id, scaleParams(d, vals, 1)));
            setDef(null);
            onDone();
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/** Pixel-sized parameters shrink with the preview so it looks like the result. */
function scaleParams(def: AdjustDef, v: Record<string, number>, k: number): Record<string, number> {
  const kk = Math.min(1, k);
  const out = { ...v };
  for (const key of ["radius", "dist", "size", "shift"]) if (key in out && def.params.some((p) => p.key === key)) out[key] = Math.max(key === "size" ? 2 : 0, out[key] * kk);
  return out;
}

// ------------------------------------------------------------------ Pages
export function PagesPanel({ ws, tick, onGo }: { ws: Workspace; tick: number; onGo: (i: number) => void }) {
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const p of ws.doc.pages) {
        const src = await ws.sourcesFor(p);
        if (!alive) return;
        out[p.id] = pageToCanvas(p, src, 140).toDataURL("image/jpeg", 0.7);
      }
      if (alive) setThumbs(out);
    })();
    return () => {
      alive = false;
    };
  }, [ws, tick]);
  const pages = ws.doc.pages.map((p, i) => ({ p, i })).filter(({ p }) => !onlyMarked || p.bookmarked);
  return (
    <div className="pages">
      <div className="row gap wrap">
        <button className="btn" onClick={() => ws.addPage()}>
          <Plus size={16} /> Page
        </button>
        <button className="btn" onClick={() => ws.duplicatePage()}>
          <Copy size={16} /> Duplicate
        </button>
        <button className="btn" onClick={() => ws.movePage(-1)}>
          <ArrowUp size={16} />
        </button>
        <button className="btn" onClick={() => ws.movePage(1)}>
          <ArrowDown size={16} />
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm("Delete this page?")) void ws.deletePage();
          }}
        >
          <Trash2 size={16} />
        </button>
        <Toggle label="Bookmarked only" checked={onlyMarked} onChange={setOnlyMarked} />
      </div>
      <div className="page-grid">
        {pages.map(({ p, i }) => (
          <button key={p.id} className={"page-thumb" + (i === ws.pageIndex ? " on" : "")} onClick={() => onGo(i)}>
            {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" /> : <div className="ph" style={{ aspectRatio: `${p.w}/${p.h}` }} />}
            <span>
              {i + 1}
              {p.bookmarked && <Bookmark size={12} fill="currentColor" />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Time-lapse
export function TimelapsePanel({ frames, title }: { frames: string[]; title: string }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % frames.length), 1000 / 12);
    return () => clearInterval(t);
  }, [playing, frames.length]);
  if (!frames.length) return <p className="hint">Nothing recorded yet. Every change you paint is recorded here.</p>;
  return (
    <div className="timelapse">
      <img src={frames[Math.min(i, frames.length - 1)]} alt="time-lapse frame" />
      <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => (setPlaying(false), setI(Number(e.target.value)))} />
      <div className="row gap">
        <button className="btn" onClick={() => setPlaying(!playing)}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const { framesToVideo } = await import("../lib/video");
              const v = await framesToVideo(frames, 15);
              await shareOrDownload(v.blob, `${safeName(title)} time-lapse.${v.ext}`);
            } catch (err) {
              alert("Video export is not supported in this browser: " + (err as Error).message);
            }
            setBusy(false);
          }}
        >
          <Download size={16} /> {busy ? "Rendering…" : "Export video"}
        </button>
        <span className="hint">{frames.length} frames</span>
      </div>
    </div>
  );
}

export { Seg };
