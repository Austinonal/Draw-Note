import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, Undo2, Redo2, Layers, Wrench, PenTool, Pencil, Highlighter, Feather, Eraser, Lasso, Type, Shapes, StickyNote, Sparkles, Hand, Brush, Droplet, PaintBucket, Pipette,
  SquareDashed, Move, SlidersHorizontal, LayoutGrid, ChevronRight, Bookmark, Maximize, FlipHorizontal2, FlipVertical2, RotateCw, Check, X, Trash2, Copy, Scissors, ArrowUpToLine, Palette, Play, Pause, Film,
  Image as ImageIcon, Ruler, Notebook, Paintbrush,
} from "lucide-react";
import type { Doc, PenKind, ShapeKind } from "../lib/model";
import { PAPERS } from "../lib/model";
import { Workspace } from "../editor/workspace";
import { defaultToolState, type NoteTool, type PaintTool, type TextEditRequest, type ToolState, type PaintSlot } from "../editor/types";
import { ColorPanel } from "./ColorPanel";
import { AdjustPanel, BrushPanel, LayersPanel, PagesPanel, TimelapsePanel } from "./panels";
import { Panel, PdfModeSheet, Range, Seg, Toggle, Toast, VSlider, pickFile, readAsDataUrl, shareOrDownload, safeName } from "./ui";
import type { Page } from "../lib/model";
import type { Brush as BrushDef } from "../paint/brushes";
import { exportBackup, getValue, putValue } from "../lib/storage";
import { preloadBrushImages } from "../paint/engine";
import { DEFAULT_PALETTES } from "../paint/color";
import { compositeLayers } from "../lib/render";
import type { Symmetry } from "../paint/engine";

type PanelId = "color" | "layers" | "brushes" | "adjust" | "actions" | "pages" | "timelapse" | null;

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function loadArr<T>(key: string, fallback: T[]): T[] {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T[]) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked */
  }
}

const NOTE_TOOLS: { id: NoteTool; label: string; icon: React.ReactNode }[] = [
  { id: "pen", label: "Pen", icon: <PenTool size={20} /> },
  { id: "fountain", label: "Fountain pen", icon: <Feather size={20} /> },
  { id: "pencil", label: "Pencil", icon: <Pencil size={20} /> },
  { id: "highlighter", label: "Highlighter", icon: <Highlighter size={20} /> },
  { id: "eraser", label: "Eraser", icon: <Eraser size={20} /> },
  { id: "lasso", label: "Lasso", icon: <Lasso size={20} /> },
  { id: "shape", label: "Shapes", icon: <Shapes size={20} /> },
  { id: "text", label: "Text", icon: <Type size={20} /> },
  { id: "sticky", label: "Sticky note", icon: <StickyNote size={20} /> },
  { id: "tape", label: "Tape", icon: <Ruler size={20} /> },
  { id: "laser", label: "Laser pointer", icon: <Sparkles size={20} /> },
  { id: "lift", label: "Lift PDF element", icon: <Scissors size={20} /> },
  { id: "hand", label: "Pan", icon: <Hand size={20} /> },
];
const PAINT_TOOLS: { id: PaintTool; label: string; icon: React.ReactNode }[] = [
  { id: "brush", label: "Paint", icon: <Brush size={20} /> },
  { id: "smudge", label: "Smudge", icon: <Droplet size={20} /> },
  { id: "erase", label: "Erase", icon: <Eraser size={20} /> },
  { id: "fill", label: "Fill (ColorDrop)", icon: <PaintBucket size={20} /> },
  { id: "eyedropper", label: "Eyedropper", icon: <Pipette size={20} /> },
  { id: "select", label: "Selection", icon: <SquareDashed size={20} /> },
  { id: "transform", label: "Transform", icon: <Move size={20} /> },
  { id: "hand", label: "Pan", icon: <Hand size={20} /> },
];

export function Editor({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<Workspace | null>(null);
  const [ts, setTsRaw] = useState<ToolState>(() => {
    const t = load("dn.tools", defaultToolState());
    // an editable PDF opens with the Text tool, ready to tap its text
    return { ...t, mode: doc.kind === "canvas" ? "paint" : "notes", noteTool: doc.pdfEditable ? "text" : t.noteTool, readOnly: false, animation: false };
  });
  const [tick, setTick] = useState(0);
  const [panel, setPanel] = useState<PanelId>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [textReq, setTextReq] = useState<TextEditRequest | null>(null);
  const [textVal, setTextVal] = useState("");
  const [custom, setCustomRaw] = useState<BrushDef[]>(() => loadArr("dn.brushes", []));
  const [palettes, setPalettesRaw] = useState(() => loadArr("dn.palettes", DEFAULT_PALETTES));
  const [history, setHistory] = useState<string[]>(() => loadArr("dn.colorHistory", []));
  const [title, setTitle] = useState(doc.title);
  const [busy, setBusy] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [refOn, setRefOn] = useState(false);

  const setTs = useCallback((patch: Partial<ToolState>) => {
    setTsRaw((t) => {
      const n = { ...t, ...patch };
      save("dn.tools", { ...n, readOnly: false, animation: false });
      return n;
    });
  }, []);
  const setCustom = (b: BrushDef[]) => {
    setCustomRaw(b);
    void Promise.all(b.map(preloadBrushImages)).then(() => setTick((t) => t + 1));
    // IndexedDB, not localStorage: imported brushes carry PNG textures (~5 MB localStorage limit)
    putValue("settings/brushes", b).catch(() => setToast("Could not save brushes"));
  };
  useEffect(() => {
    void getValue<BrushDef[]>("settings/brushes").then(async (b) => {
      if (!b) return; // first run: keep the localStorage copy, it is migrated on the next save
      await Promise.all(b.map(preloadBrushImages));
      setCustomRaw(b);
    });
  }, []);
  const setPalettes = (p: typeof palettes) => {
    setPalettesRaw(p);
    save("dn.palettes", p);
  };

  const ws = wsRef.current;

  useEffect(() => {
    const c = canvasRef.current!;
    const w = new Workspace(c, doc, ts, {
      changed: () => setTick((x) => x + 1),
      colorPicked: (col) => {
        setTs({ color: col, ...(w.ts.mode === "paint" && w.ts.paintTool === "eyedropper" ? { paintTool: "brush" as PaintTool } : {}) });
        setToast(col.toUpperCase());
      },
      editText: (req) => {
        setTextReq(req);
        if (req) {
          const o = w.page.objects.find((x) => x.id === req.id);
          const line = w.page.pdfLines?.find((l) => l.id === req.id);
          setTextVal(line ? line.text : o && (o.type === "text" || o.type === "sticky") ? o.text : "");
        }
      },
      toast: (m) => setToast(m),
    });
    w.customBrushes = custom;
    wsRef.current = w;
    (window as unknown as { __ws?: Workspace }).__ws = w;
    w.resize();
    void w.loadPage(0);
    const ro = new ResizeObserver(() => w.resize());
    ro.observe(c);
    const flush = () => void w.flush();
    const vis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", vis);
    return () => {
      ro.disconnect();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", vis);
      void w.flush();
      w.destroy();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // keep the workspace's tool state current
  useEffect(() => {
    if (!wsRef.current) return;
    wsRef.current.ts = ts;
    wsRef.current.customBrushes = custom;
    if (ts.mode === "paint" && ts.paintTool !== "transform") wsRef.current.commitFloating();
    wsRef.current.request();
  }, [ts, custom]);

  // colour history
  useEffect(() => {
    const t = setTimeout(() => {
      setHistory((h) => {
        if (h[0] === ts.color) return h;
        const n = [ts.color, ...h.filter((c) => c !== ts.color)].slice(0, 16);
        save("dn.colorHistory", n);
        return n;
      });
    }, 900);
    return () => clearTimeout(t);
  }, [ts.color]);

  // keyboard shortcuts (desktop / tablets with keyboards)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const w = wsRef.current;
      if (!w || textReq || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) w.redo();
        else w.undo();
      } else if (mod && e.key.toLowerCase() === "y") w.redo();
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (w.selected.size) w.deleteSelected();
      } else if (e.key === "Escape") {
        w.selected.clear();
        w.clearSelection();
        w.cancelFloating();
      } else if (!mod) {
        const k = e.key.toLowerCase();
        if (k === "b") setTs({ mode: "paint", paintTool: "brush" });
        if (k === "s") setTs({ mode: "paint", paintTool: "smudge" });
        if (k === "e") setTs(ts.mode === "paint" ? { paintTool: "erase" } : { noteTool: "eraser" });
        if (k === "p") setTs({ mode: "notes", noteTool: "pen" });
        if (k === "l") setTs({ mode: "notes", noteTool: "lasso" });
        if (k === "t") setTs({ mode: "notes", noteTool: "text" });
        if (k === "v") setTs({ mode: "paint", paintTool: "transform" });
        if (k === "[" || k === "]") {
          const slot = slotOf(ts.paintTool);
          setTs({ size: { ...ts.size, [slot]: Math.max(0, Math.min(1, ts.size[slot] + (k === "]" ? 0.05 : -0.05))) } });
        }
        if (k === "0") w.fit();
        if (k === "=" || k === "+") w.zoomBy(1.25);
        if (k === "-") w.zoomBy(0.8);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ts, setTs, textReq]);

  const finishText = () => {
    if (textReq && wsRef.current) wsRef.current.finishText(textReq.id, textVal);
  };

  const closeEditor = async () => {
    finishText();
    const w = wsRef.current;
    if (w) {
      w.commitFloating();
      doc.title = title.trim() || "Untitled";
      await w.flush();
      w.markDocDirty();
      await w.flush();
    }
    onClose();
  };

  const goPage = async (i: number) => {
    finishText();
    await wsRef.current?.loadPage(i);
  };

  const slot: PaintSlot = slotOf(ts.paintTool);
  const page = ws?.page;
  const pageCount = doc.pages.length;

  const toolOptions = useMemo(() => renderToolOptions(ts, setTs, ws), [ts, setTs, ws, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // live reference thumbnail of the canvas
  const refThumb = useMemo(() => (refOn && !reference && ws ? ws.thumbnail(240) : ""), [refOn, reference, ws, tick]);

  const exportAs = async (kind: "png" | "jpg" | "pdf" | "pdfPage" | "backup" | "pngLayers") => {
    const w = wsRef.current;
    if (!w) return;
    setBusy("Exporting…");
    try {
      await w.flush();
      const name = safeName(title);
      if (kind === "png" || kind === "jpg") {
        const width = doc.kind === "canvas" ? w.page.w : w.page.w * 2;
        const c = w.flatten(width);
        const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), kind === "png" ? "image/png" : "image/jpeg", 0.93));
        await shareOrDownload(blob, `${name}${pageCount > 1 ? "-p" + (w.pageIndex + 1) : ""}.${kind}`);
      } else if (kind === "pngLayers") {
        // each layer as its own transparent PNG, top to bottom
        for (const l of [...w.page.layers].reverse()) {
          const c = w.layers.get(l.id);
          if (!c) continue;
          const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
          await shareOrDownload(blob, `${name}-${safeName(l.name)}.png`);
        }
      } else if (kind === "pdf" || kind === "pdfPage") {
        const sources = new Map<string, Awaited<ReturnType<Workspace["sourcesFor"]>>>();
        const pages = kind === "pdf" ? doc.pages : [w.page];
        for (const p of pages) sources.set(p.id, await w.sourcesFor(p));
        const { exportPdf } = await import("../lib/pdf");
        const blob = await exportPdf(doc, (p) => sources.get(p.id)!, pages);
        await shareOrDownload(blob, `${name}.pdf`);
      } else {
        const blob = await exportBackup([doc]);
        await shareOrDownload(blob, `${name}.drawnote.json`);
      }
    } catch (e) {
      alert("Export failed: " + (e as Error).message);
    }
    setBusy(null);
  };

  const insertPhoto = async () => {
    const [f] = await pickFile("image/*");
    if (!f || !wsRef.current) return;
    const url = await readAsDataUrl(f);
    if (ts.mode === "paint") {
      await wsRef.current.insertImageLayer(url, f.name.replace(/\.[^.]+$/, ""));
      setTs({ paintTool: "transform" });
    } else {
      const img = new Image();
      img.onload = () => wsRef.current?.insertImageObject(url, img.width, img.height);
      img.src = url;
      setTs({ noteTool: "lasso" });
    }
    setPanel(null);
  };

  const importPdfPages = async () => {
    const [f] = await pickFile("application/pdf");
    if (!f || !wsRef.current) return;
    setBusy("Importing PDF…");
    try {
      const { importPdf } = await import("../lib/pdf");
      const pages = await importPdf(f, (d, t) => setBusy(`Importing PDF… ${d}/${t}`));
      setPdfPending(pages);
    } catch (e) {
      alert("PDF import failed: " + (e as Error).message);
    }
    setBusy(null);
    setPanel(null);
  };
  const [pdfPending, setPdfPending] = useState<Page[] | null>(null);
  const finishPdfImport = async (editable: boolean) => {
    const pages = pdfPending;
    setPdfPending(null);
    if (!pages || !wsRef.current) return;
    doc.pdfEditable = editable;
    await wsRef.current.insertPages(pages);
    if (editable) setTs({ mode: "notes", noteTool: "text" });
  };
  const hasPdf = doc.pages.some((p) => p.bg);
  const runOcr = async (all: boolean) => {
    const w = wsRef.current;
    if (!w) return;
    setPanel(null);
    setBusy("Loading OCR (first time downloads ~7 MB)…");
    try {
      const n = await w.ocrPages(all, setBusy);
      setTs({ mode: "notes", noteTool: "text" });
      setToast(n ? `Found ${n} line${n > 1 ? "s" : ""} — tap one to edit` : "No text found");
    } catch (e) {
      alert("OCR failed: " + (e as Error).message);
    }
    setBusy(null);
  };

  const exportAnimation = async () => {
    const w = wsRef.current;
    if (!w) return;
    setBusy("Rendering animation…");
    try {
      const { animationToVideo } = await import("../lib/video");
      const p = w.page;
      const k = Math.min(1, 1080 / Math.max(p.w, p.h));
      const W = Math.round(p.w * k),
        H = Math.round(p.h * k);
      const v = await animationToVideo(p.layers.length, W, H, w.fps, (g, i) => {
        g.fillStyle = p.paperColor;
        g.fillRect(0, 0, W, H);
        g.save();
        g.scale(W / w.rw, H / w.rh);
        compositeLayers(g, p.layers.map((l, j) => ({ ...l, visible: j === i })), w.layerSource, w.rw, w.rh);
        g.restore();
      });
      await shareOrDownload(v.blob, `${safeName(title)} animation.${v.ext}`);
    } catch (e) {
      alert("Animation export is not supported here: " + (e as Error).message);
    }
    setBusy(null);
  };

  const modeSwitch = (
    <div className="mode-switch" role="tablist" aria-label="Mode">
      <button role="tab" aria-selected={ts.mode === "notes"} className={ts.mode === "notes" ? "on" : ""} onClick={() => setTs({ mode: "notes" })}>
        <Notebook size={16} /> <span>Notes</span>
      </button>
      <button role="tab" aria-selected={ts.mode === "paint"} className={ts.mode === "paint" ? "on" : ""} onClick={() => setTs({ mode: "paint" })}>
        <Paintbrush size={16} /> <span>Paint</span>
      </button>
    </div>
  );

  const sizeValue = ts.mode === "paint" ? ts.size[slot] : 0;

  return (
    <div className={"editor mode-" + ts.mode}>
      <header className="topbar">
        <button className="icon-btn" onClick={closeEditor} aria-label="Back to library">
          <ChevronLeft size={22} />
        </button>
        <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => ((doc.title = title.trim() || "Untitled"), ws?.markDocDirty())} aria-label="Title" />
        {modeSwitch}
        <div className="spacer" />
        <div className="top-tools">
        <button className="icon-btn" onClick={() => ws?.undo()} disabled={!ws?.canUndo()} aria-label="Undo">
          <Undo2 size={20} />
        </button>
        <button className="icon-btn" onClick={() => ws?.redo()} disabled={!ws?.canRedo()} aria-label="Redo">
          <Redo2 size={20} />
        </button>
        {ts.mode === "paint" && (
          <>
            <button className={"icon-btn" + (panel === "brushes" ? " on" : "")} onClick={() => setPanel(panel === "brushes" ? null : "brushes")} aria-label="Brush library">
              <Brush size={20} />
            </button>
            <button className={"icon-btn" + (panel === "adjust" ? " on" : "")} onClick={() => setPanel(panel === "adjust" ? null : "adjust")} aria-label="Adjustments">
              <SlidersHorizontal size={20} />
            </button>
          </>
        )}
        <button className={"icon-btn" + (panel === "layers" ? " on" : "")} onClick={() => setPanel(panel === "layers" ? null : "layers")} aria-label="Layers">
          <Layers size={20} />
        </button>
        <button className={"icon-btn" + (panel === "pages" ? " on" : "")} onClick={() => setPanel(panel === "pages" ? null : "pages")} aria-label="Pages">
          <LayoutGrid size={20} />
        </button>
        <button className={"icon-btn" + (panel === "actions" ? " on" : "")} onClick={() => setPanel(panel === "actions" ? null : "actions")} aria-label="Actions">
          <Wrench size={20} />
        </button>
        <button className="color-btn" style={{ background: ts.color }} onClick={() => setPanel(panel === "color" ? null : "color")} aria-label="Colour" />
        </div>
      </header>

      <div className="stage" onPointerDownCapture={(e) => textReq && (e.target as HTMLElement).tagName !== "TEXTAREA" && finishText()}>
        <canvas ref={canvasRef} className="surface" />
        {textReq && (
          <textarea
            className={"text-edit " + textReq.kind}
            autoFocus
            style={{ left: textReq.left, top: textReq.top, width: Math.max(80, textReq.width), minHeight: textReq.height, fontSize: textReq.fontSize, color: textReq.color ?? (textReq.kind === "text" ? ts.color : "#2a2a2a"), fontFamily: textReq.font }}
            value={textVal}
            onChange={(e) => setTextVal(e.target.value)}
            onBlur={finishText}
            placeholder={textReq.kind === "text" ? "Type…" : "Note…"}
          />
        )}

        {/* ProCraft-style sidebar: size, opacity, undo / redo, eyedropper */}
        <aside className="sidebar" onPointerDown={(e) => e.stopPropagation()}>
          {ts.mode === "paint" ? (
            <>
              <VSlider label="Size" value={sizeValue} onChange={(v) => setTs({ size: { ...ts.size, [slot]: v } })} display={sizeLabel(ws, slot, ts)} />
              <button className="icon-btn sm" onClick={() => setTs({ paintTool: "eyedropper" })} aria-label="Eyedropper">
                <Pipette size={18} />
              </button>
              <VSlider label="Opacity" value={ts.opacity[slot]} onChange={(v) => setTs({ opacity: { ...ts.opacity, [slot]: v } })} />
            </>
          ) : (
            <>
              <VSlider
                label="Width"
                value={noteWidth01(ts)}
                onChange={(v) => setNoteWidth(ts, setTs, v)}
                display={ts.noteTool === "eraser" ? `${Math.round(ts.eraserSize)}` : `${(ts.penWidth[penOf(ts.noteTool)] ?? 3).toFixed(1)}`}
              />
            </>
          )}
        </aside>

        {/* contextual bars */}
        {ws && ws.selected.size > 0 && ts.mode === "notes" && (
          <div className="context-bar">
            <button onClick={() => ws.deleteSelected()}>
              <Trash2 size={16} /> Delete
            </button>
            <button onClick={() => ws.duplicateSelected()}>
              <Copy size={16} /> Duplicate
            </button>
            <button onClick={() => ws.recolorSelected(ts.color)}>
              <Palette size={16} /> Colour
            </button>
            <button onClick={() => ws.bringSelectedToFront()}>
              <ArrowUpToLine size={16} /> Front
            </button>
            <button onClick={() => ws.rasterizeSelected()} title="Flatten into the active paint layer">
              <Paintbrush size={16} /> To paint
            </button>
            <button onClick={() => (ws.selected.clear(), setTick((t) => t + 1), ws.request())}>
              <Check size={16} />
            </button>
          </div>
        )}
        {ws && ws.selection && !ws.floating && ts.mode === "paint" && (
          <div className="context-bar">
            <button onClick={() => ws.invertSelection()}>Invert</button>
            <button onClick={() => ws.copyToNewLayer(false)}>
              <Copy size={16} /> Copy
            </button>
            <button onClick={() => ws.copyToNewLayer(true)}>
              <Scissors size={16} /> Cut
            </button>
            <button onClick={() => ws.fillSelected()}>
              <PaintBucket size={16} /> Fill
            </button>
            <button onClick={() => ws.clearSelected()}>
              <Eraser size={16} /> Clear
            </button>
            <button onClick={() => setTs({ paintTool: "transform" })}>
              <Move size={16} />
            </button>
            <button onClick={() => ws.clearSelection()}>
              <X size={16} />
            </button>
          </div>
        )}
        {ws && ts.mode === "paint" && ts.paintTool === "transform" && (
          <div className="context-bar">
            <button onClick={() => ws.transformOp("flipH")} aria-label="Flip horizontal">
              <FlipHorizontal2 size={16} />
            </button>
            <button onClick={() => ws.transformOp("flipV")} aria-label="Flip vertical">
              <FlipVertical2 size={16} />
            </button>
            <button onClick={() => ws.transformOp("rot45")} aria-label="Rotate 45°">
              <RotateCw size={16} /> 45°
            </button>
            <button onClick={() => ws.transformOp("fit")}>
              <Maximize size={16} /> Fit
            </button>
            <button onClick={() => ws.transformOp("reset")}>Reset</button>
            <button onClick={() => (ws.cancelFloating(), setTs({ paintTool: "brush" }))}>
              <X size={16} />
            </button>
            <button className="primary" onClick={() => (ws.commitFloating(), setTs({ paintTool: "brush" }))}>
              <Check size={16} /> Done
            </button>
          </div>
        )}
        {ws && ts.animation && (
          <div className="anim-bar" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={() => ws.play(!ws.playing)}>{ws.playing ? <Pause size={16} /> : <Play size={16} />}</button>
            <div className="frames">
              {ws.page.layers.map((l, i) => (
                <button key={l.id} className={l.id === ws.page.activeLayer ? "on" : ""} onClick={() => ws.selectLayer(l.id)}>
                  {i + 1}
                </button>
              ))}
              <button onClick={() => ws.addLayer()}>+</button>
            </div>
            <label>
              FPS
              <input type="number" min={1} max={30} value={ws.fps} onChange={(e) => ((ws.fps = Math.max(1, Math.min(30, Number(e.target.value) || 8))), ws.playing && ws.play(true), setTick((t) => t + 1))} />
            </label>
            <button onClick={() => setTs({ onion: !ts.onion })} className={ts.onion ? "on" : ""}>
              Onion
            </button>
            <button onClick={exportAnimation}>
              <Film size={16} />
            </button>
          </div>
        )}

        {refOn && (
          <div className="reference" onPointerDown={(e) => e.stopPropagation()}>
            <div className="ref-head">
              <span>Reference</span>
              <button
                className="link"
                onClick={async () => {
                  const [f] = await pickFile("image/*");
                  if (f) setReference(await readAsDataUrl(f));
                }}
              >
                Image
              </button>
              <button className="link" onClick={() => setReference(null)}>
                Canvas
              </button>
              <button className="icon-btn sm" onClick={() => setRefOn(false)}>
                <X size={14} />
              </button>
            </div>
            <img src={reference ?? refThumb} alt="reference" />
          </div>
        )}

        <div className="page-nav" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icon-btn sm" disabled={!ws || ws.pageIndex === 0} onClick={() => ws && goPage(ws.pageIndex - 1)} aria-label="Previous page">
            <ChevronLeft size={18} />
          </button>
          <span>
            {(ws?.pageIndex ?? 0) + 1} / {pageCount}
          </span>
          <button className="icon-btn sm" disabled={!ws || ws.pageIndex >= pageCount - 1} onClick={() => ws && goPage(ws.pageIndex + 1)} aria-label="Next page">
            <ChevronRight size={18} />
          </button>
          {doc.kind === "notebook" && (
            <button className="icon-btn sm" onClick={() => ws?.addPage()} aria-label="Add page">
              +
            </button>
          )}
          <button className={"icon-btn sm" + (page?.bookmarked ? " on" : "")} onClick={() => page && ((page.bookmarked = !page.bookmarked), ws?.markDocDirty())} aria-label="Bookmark page">
            <Bookmark size={16} fill={page?.bookmarked ? "currentColor" : "none"} />
          </button>
          <button className="icon-btn sm" onClick={() => ws?.fit()} aria-label="Fit to screen">
            <Maximize size={16} />
          </button>
        </div>

        {panel && ws && (
          <Panel
            title={{ color: "Colours", layers: "Layers", brushes: `Brush library · ${slot}`, adjust: "Adjustments", actions: "Actions", pages: "Pages", timelapse: "Time-lapse replay" }[panel]}
            onClose={() => setPanel(null)}
          >
            {panel === "color" && <ColorPanel color={ts.color} onChange={(c) => setTs({ color: c })} history={history} palettes={palettes} setPalettes={setPalettes} />}
            {panel === "layers" && <LayersPanel ws={ws} tick={tick} />}
            {panel === "brushes" && (
              <BrushPanel
                current={ts.brushId[slot]}
                onPick={(bid) => setTs({ brushId: { ...ts.brushId, [slot]: bid } })}
                color={ts.color}
                custom={custom}
                setCustom={setCustom}
              />
            )}
            {panel === "adjust" && <AdjustPanel ws={ws} onDone={() => setPanel(null)} />}
            {panel === "pages" && <PagesPanel ws={ws} tick={tick} onGo={(i) => void goPage(i)} />}
            {panel === "timelapse" && <TimelapsePanel frames={doc.timelapse ?? []} title={title} />}
            {panel === "actions" && (
              <div className="actions">
                <h4>Add</h4>
                <div className="chips">
                  <button onClick={insertPhoto}>
                    <ImageIcon size={14} /> Insert photo {ts.mode === "paint" ? "(as layer)" : "(as object)"}
                  </button>
                  <button onClick={importPdfPages}>Import PDF pages</button>
                  <button onClick={() => (setTs({ mode: "notes", noteTool: "text" }), setPanel(null))}>Add text</button>
                </div>
                <h4>Page &amp; canvas</h4>
                {page && doc.kind === "notebook" && (
                  <select value={page.paper} onChange={(e) => ((page.paper = e.target.value as typeof page.paper), ws.markDocDirty(), ws.request())}>
                    {PAPERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        Paper: {p.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="chips">
                  <button onClick={() => ws.flipCanvas("h")}>
                    <FlipHorizontal2 size={14} /> Flip canvas
                  </button>
                  <button onClick={() => ws.flipCanvas("v")}>
                    <FlipVertical2 size={14} /> Flip vertical
                  </button>
                  <button onClick={() => ws.selectAll()}>Select all</button>
                  <button
                    className="danger"
                    onClick={() => {
                      if (confirm("Clear everything on this page?")) ws.clearPage();
                    }}
                  >
                    Clear page
                  </button>
                </div>
                <h4>Guides &amp; assists</h4>
                <label className="field">
                  Symmetry
                  <select value={ts.symmetry} onChange={(e) => setTs({ symmetry: e.target.value as Symmetry, mode: "paint" })}>
                    <option value="off">Off</option>
                    <option value="vertical">Vertical</option>
                    <option value="horizontal">Horizontal</option>
                    <option value="quadrant">Quadrant</option>
                    <option value="radial">Radial (6)</option>
                  </select>
                </label>
                <Toggle label="Drawing guide (grid)" checked={ts.gridGuide} onChange={(v) => setTs({ gridGuide: v })} />
                <Toggle label="Animation assist (layers = frames)" checked={ts.animation} onChange={(v) => (setTs({ animation: v }), v || ws.play(false))} />
                <Toggle label="Reference window" checked={refOn} onChange={setRefOn} />
                <Toggle label="QuickShape (hold to snap)" checked={ts.quickShape} onChange={(v) => setTs({ quickShape: v })} />
                <h4>Share</h4>
                <div className="chips">
                  <button onClick={() => exportAs("png")}>PNG</button>
                  <button onClick={() => exportAs("jpg")}>JPEG</button>
                  <button onClick={() => exportAs("pdfPage")}>PDF (this page)</button>
                  <button onClick={() => exportAs("pdf")}>PDF (all pages)</button>
                  <button onClick={() => exportAs("pngLayers")}>PNG layers</button>
                  <button onClick={() => exportAs("backup")}>DrawNote file</button>
                  <button onClick={() => setPanel("timelapse")}>
                    <Film size={14} /> Time-lapse
                  </button>
                </div>
                <h4>Prefs</h4>
                <Toggle label="Draw with finger (off = stylus only, fingers pan/zoom)" checked={ts.fingerDraws} onChange={(v) => setTs({ fingerDraws: v })} />
                <Toggle label="Read-only (view mode)" checked={ts.readOnly} onChange={(v) => setTs({ readOnly: v })} />
                {hasPdf && (
                  <Toggle
                    label="Edit PDF text & elements"
                    checked={!!doc.pdfEditable}
                    onChange={(v) => {
                      doc.pdfEditable = v;
                      ws.markDocDirty();
                      if (!v && ts.noteTool === "lift") setTs({ noteTool: "pen" });
                      else if (v) {
                        setTs({ mode: "notes", noteTool: "text" });
                        if (!doc.pages.some((p) => p.pdfLines?.length)) setToast("No text layer found — use Detect text (OCR) below");
                      }
                      ws.request();
                    }}
                  />
                )}
                {hasPdf && (
                  <div className="chips">
                    <button onClick={() => runOcr(false)}>Detect text (OCR) — this page</button>
                    <button onClick={() => runOcr(true)}>OCR all pages</button>
                  </div>
                )}
                <p className="hint">Gestures: pinch to zoom (and rotate on canvases), two-finger tap = undo, three-finger tap = redo. Hold at the end of a line to snap a shape.</p>
              </div>
            )}
          </Panel>
        )}
      </div>

      <nav className="toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <div className="tool-options">{toolOptions}</div>
        <div className="tools">
          {(ts.mode === "notes" ? NOTE_TOOLS.filter((t) => t.id !== "lift" || doc.pdfEditable) : PAINT_TOOLS).map((t) => {
            const on = ts.mode === "notes" ? ts.noteTool === t.id : ts.paintTool === t.id;
            return (
              <button
                key={t.id}
                className={"tool" + (on ? " on" : "")}
                aria-label={t.label}
                title={t.label}
                onClick={() => {
                  if (ts.mode === "notes") setTs({ noteTool: t.id as NoteTool });
                  else {
                    const id = t.id as PaintTool;
                    if (on && (id === "brush" || id === "smudge" || id === "erase")) setPanel(panel === "brushes" ? null : "brushes");
                    setTs({ paintTool: id });
                    if (id === "transform") ws?.beginTransform();
                  }
                }}
              >
                {t.icon}
                <span>{t.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {pdfPending && <PdfModeSheet onPick={(v) => void finishPdfImport(v)} onClose={() => void finishPdfImport(!!doc.pdfEditable)} />}
      {busy && <div className="busy">{busy}</div>}
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function slotOf(t: PaintTool): PaintSlot {
  return t === "erase" ? "erase" : t === "smudge" ? "smudge" : "brush";
}
function penOf(t: NoteTool): PenKind {
  return t === "pencil" || t === "highlighter" || t === "fountain" ? t : "pen";
}
function noteWidth01(ts: ToolState): number {
  if (ts.noteTool === "eraser") return (ts.eraserSize - 4) / 76;
  const k = penOf(ts.noteTool);
  const max = k === "highlighter" ? 40 : 16;
  return (ts.penWidth[k] - 0.5) / (max - 0.5);
}
function setNoteWidth(ts: ToolState, setTs: (p: Partial<ToolState>) => void, v: number) {
  if (ts.noteTool === "eraser") return setTs({ eraserSize: 4 + v * 76 });
  const k = penOf(ts.noteTool);
  const max = k === "highlighter" ? 40 : 16;
  setTs({ penWidth: { ...ts.penWidth, [k]: Math.round((0.5 + v * (max - 0.5)) * 10) / 10 } });
}
function sizeLabel(ws: Workspace | null, slot: PaintSlot, ts: ToolState): string {
  if (!ws) return "";
  const b = ws.brushFor(slot);
  const t = ts.size[slot];
  return `${Math.round(b.minSize + (b.maxSize - b.minSize) * t * t)}px`;
}

function renderToolOptions(ts: ToolState, setTs: (p: Partial<ToolState>) => void, ws: Workspace | null): React.ReactNode {
  const swatches = ["#1b1f27", "#3d6fb6", "#c2453d", "#2f8a5f", "#d48a1f", "#6d4bb3", "#ffffff"];
  const hl = ["#fff176", "#a5d6a7", "#90caf9", "#f48fb1", "#ffcc80"];
  const quickColors = (list: string[]) => (
    <div className="quick-colors">
      {list.map((c) => (
        <button key={c} className={ts.color === c ? "on" : ""} style={{ background: c }} onClick={() => setTs({ color: c })} aria-label={c} />
      ))}
    </div>
  );
  if (ts.mode === "notes") {
    switch (ts.noteTool) {
      case "pen":
      case "pencil":
      case "fountain":
        return quickColors(swatches);
      case "highlighter":
        return (
          <>
            {quickColors(hl)}
            <Range label="Opacity" value={ts.highlighterOpacity * 100} min={10} max={80} onChange={(v) => setTs({ highlighterOpacity: v / 100 })} suffix="%" />
          </>
        );
      case "eraser":
        return (
          <Seg
            value={ts.eraserMode}
            onChange={(v) => setTs({ eraserMode: v })}
            options={[
              { id: "partial", label: "Partial" },
              { id: "object", label: "Whole stroke" },
            ]}
          />
        );
      case "shape":
        return (
          <>
            <Seg<ShapeKind>
              value={ts.shapeKind}
              onChange={(v) => setTs({ shapeKind: v })}
              options={[
                { id: "rect", label: "▭" },
                { id: "ellipse", label: "◯" },
                { id: "triangle", label: "△" },
                { id: "line", label: "／" },
                { id: "arrow", label: "→" },
              ]}
            />
            <Toggle label="Fill" checked={ts.shapeFill} onChange={(v) => setTs({ shapeFill: v })} />
          </>
        );
      case "text":
        return <Range label="Text size" value={ts.textSize} min={10} max={72} onChange={(v) => setTs({ textSize: v })} />;
      case "sticky":
        return (
          <div className="quick-colors">
            {["#fff59d", "#ffcc80", "#a5d6a7", "#90caf9", "#f48fb1", "#ce93d8"].map((c) => (
              <button key={c} className={ts.stickyColor === c ? "on" : ""} style={{ background: c }} onClick={() => setTs({ stickyColor: c })} aria-label={c} />
            ))}
          </div>
        );
      case "tape":
        return (
          <div className="quick-colors">
            {["#f48fb1", "#90caf9", "#a5d6a7", "#ffe082", "#b0bec5"].map((c) => (
              <button key={c} className={ts.tapeColor === c ? "on" : ""} style={{ background: c }} onClick={() => setTs({ tapeColor: c })} aria-label={c} />
            ))}
            <span className="hint">Drag to place · tap tape to reveal</span>
          </div>
        );
      case "lasso":
        return <span className="hint">Circle items to select · drag to move · corner to resize</span>;
      case "lift":
        return <span className="hint">Drag a box around a picture, table or block of the PDF to lift it out and move it</span>;
      case "laser":
        return <span className="hint">Point for presenting — nothing is saved</span>;
      default:
        return null;
    }
  }
  switch (ts.paintTool) {
    case "brush":
    case "smudge":
    case "erase": {
      const s = slotOf(ts.paintTool);
      const b = ws?.brushFor(s);
      return (
        <>
          <span className="brush-name">{b?.name}</span>
          {ts.paintTool === "brush" && quickColors(swatches)}
        </>
      );
    }
    case "fill":
      return (
        <>
          <Range label="Threshold" value={ts.fillThreshold * 100} min={0} max={100} onChange={(v) => setTs({ fillThreshold: v / 100 })} suffix="%" />
          <Toggle label="Reference all layers" checked={ts.fillSampleAll} onChange={(v) => setTs({ fillSampleAll: v })} />
        </>
      );
    case "select":
      return (
        <>
          <Seg
            value={ts.selectMode}
            onChange={(v) => setTs({ selectMode: v })}
            options={[
              { id: "free", label: "Freehand" },
              { id: "rect", label: "Rectangle" },
              { id: "ellipse", label: "Ellipse" },
            ]}
          />
          <Range label="Feather" value={ts.feather} min={0} max={40} onChange={(v) => setTs({ feather: v })} />
          <button className="btn" onClick={() => ws?.selectAll()}>
            All
          </button>
        </>
      );
    case "transform":
      return <span className="hint">Drag to move · drag a corner to scale and rotate</span>;
    case "eyedropper":
      return <span className="hint">Tap the canvas to pick a colour</span>;
    default:
      return null;
  }
}
