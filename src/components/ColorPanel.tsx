// Colours: Disc, Classic, Harmony, Value and Palettes, plus history (after ProCraft's Colors panel).
import { useEffect, useRef, useState } from "react";
import { HARMONIES, harmony, hexToHsv, hexToRgb, hsvToHex, hsvToRgb, rgbToHex, DEFAULT_PALETTES, type HSV, type Harmony } from "../paint/color";
import { Seg, Range, pickFile } from "./ui";

type Tab = "disc" | "classic" | "harmony" | "value" | "palettes";

function useDrag(onPoint: (x: number, y: number, r: DOMRect) => void) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      onPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.buttons) onPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    },
  };
}

function Disc({ hsv, set }: { hsv: HSV; set: (c: HSV) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const S = Math.round(260 * Math.min(3, window.devicePixelRatio || 1)); // canvas pixels = CSS size × DPR, so it stays sharp
  const r = S / 2;
  const rr = r * 0.78; // inner disc: saturation left→right, brightness bottom→top
  useEffect(() => {
    const g = ref.current!.getContext("2d")!;
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = x - r,
          dy = y - r;
        const d = Math.hypot(dx, dy);
        let rgb: [number, number, number] | null = null;
        if (d <= r && d > r * 0.84) rgb = hsvToRgb({ h: ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360, s: 1, v: 1 });
        else if (d <= rr) rgb = hsvToRgb({ h: hsv.h, s: (dx + rr) / (2 * rr), v: 1 - (dy + rr) / (2 * rr) });
        if (!rgb) continue;
        const i = (y * S + x) * 4;
        img.data[i] = rgb[0];
        img.data[i + 1] = rgb[1];
        img.data[i + 2] = rgb[2];
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  }, [hsv.h, r, rr]);
  const drag = useDrag((cx, cy, rect) => {
    const x = ((cx - rect.left) / rect.width) * S - r,
      y = ((cy - rect.top) / rect.height) * S - r;
    if (Math.hypot(x, y) > r * 0.82) set({ ...hsv, h: ((Math.atan2(y, x) * 180) / Math.PI + 450) % 360 });
    else {
      // clamp into the inner disc
      const d = Math.hypot(x, y);
      const k = d > rr ? rr / d : 1;
      set({ ...hsv, s: Math.max(0, Math.min(1, (x * k + rr) / (2 * rr))), v: Math.max(0, Math.min(1, 1 - (y * k + rr) / (2 * rr))) });
    }
  });
  const ha = ((hsv.h - 90) * Math.PI) / 180;
  return (
    <div className="disc" {...drag}>
      <canvas ref={ref} width={S} height={S} />
      <i className="marker" style={{ left: `${((r + Math.cos(ha) * r * 0.92) / S) * 100}%`, top: `${((r + Math.sin(ha) * r * 0.92) / S) * 100}%` }} />
      <i className="marker" style={{ left: `${((r - rr + hsv.s * 2 * rr) / S) * 100}%`, top: `${((r - rr + (1 - hsv.v) * 2 * rr) / S) * 100}%` }} />
    </div>
  );
}

function Classic({ hsv, set }: { hsv: HSV; set: (c: HSV) => void }) {
  const sq = useDrag((cx, cy, r) => set({ ...hsv, s: Math.max(0, Math.min(1, (cx - r.left) / r.width)), v: Math.max(0, Math.min(1, 1 - (cy - r.top) / r.height)) }));
  const hue = useDrag((cx, _cy, r) => set({ ...hsv, h: Math.max(0, Math.min(359.9, ((cx - r.left) / r.width) * 360)) }));
  return (
    <div className="classic">
      <div className="sv" style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${hsvToHex({ h: hsv.h, s: 1, v: 1 })})` }} {...sq}>
        <i className="marker" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div className="hue-bar" {...hue}>
        <i className="marker" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%" }} />
      </div>
    </div>
  );
}

export function ColorPanel({ color, onChange, history, palettes, setPalettes }: { color: string; onChange: (c: string) => void; history: string[]; palettes: { name: string; colors: string[] }[]; setPalettes: (p: { name: string; colors: string[] }[]) => void }) {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("dn.colorTab") as Tab) || "disc");
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(color));
  const [harm, setHarm] = useState<Harmony>("complementary");
  const [hex, setHex] = useState(color);
  useEffect(() => {
    if (hsvToHex(hsv) !== color) setHsv(hexToHsv(color));
    setHex(color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);
  useEffect(() => {
    try {
      localStorage.setItem("dn.colorTab", tab);
    } catch {
      /* ignore */
    }
  }, [tab]);
  const set = (c: HSV) => {
    setHsv(c);
    onChange(hsvToHex(c));
  };
  const rgb = hexToRgb(color);
  const all = palettes.length ? palettes : DEFAULT_PALETTES;
  return (
    <div className="color-panel">
      <div className="color-now">
        <span style={{ background: color }} />
        <code>{color.toUpperCase()}</code>
      </div>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { id: "disc", label: "Disc" },
          { id: "classic", label: "Classic" },
          { id: "harmony", label: "Harmony" },
          { id: "value", label: "Value" },
          { id: "palettes", label: "Palettes" },
        ]}
      />
      {tab === "disc" && <Disc hsv={hsv} set={set} />}
      {tab === "classic" && <Classic hsv={hsv} set={set} />}
      {tab === "harmony" && (
        <div>
          <Classic hsv={hsv} set={set} />
          <select value={harm} onChange={(e) => setHarm(e.target.value as Harmony)}>
            {HARMONIES.map((h) => (
              <option key={h} value={h}>
                {h[0].toUpperCase() + h.slice(1)}
              </option>
            ))}
          </select>
          <div className="swatches big">
            {harmony(hsv, harm).map((c, i) => (
              <button key={i} style={{ background: hsvToHex(c) }} onClick={() => set(c)} aria-label={hsvToHex(c)} />
            ))}
          </div>
        </div>
      )}
      {tab === "value" && (
        <div className="values">
          <Range label="Hue" value={hsv.h} min={0} max={359} onChange={(h) => set({ ...hsv, h })} suffix="°" />
          <Range label="Saturation" value={hsv.s * 100} min={0} max={100} onChange={(s) => set({ ...hsv, s: s / 100 })} suffix="%" />
          <Range label="Brightness" value={hsv.v * 100} min={0} max={100} onChange={(v) => set({ ...hsv, v: v / 100 })} suffix="%" />
          <Range label="Red" value={rgb[0]} min={0} max={255} onChange={(r) => onChange(rgbToHex(r, rgb[1], rgb[2]))} />
          <Range label="Green" value={rgb[1]} min={0} max={255} onChange={(g) => onChange(rgbToHex(rgb[0], g, rgb[2]))} />
          <Range label="Blue" value={rgb[2]} min={0} max={255} onChange={(b) => onChange(rgbToHex(rgb[0], rgb[1], b))} />
          <label className="hex">
            Hex
            <input
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                if (/^#?[0-9a-f]{6}$/i.test(e.target.value)) onChange("#" + e.target.value.replace("#", "").toLowerCase());
              }}
            />
          </label>
        </div>
      )}
      {tab === "palettes" && (
        <div className="palettes">
          {all.map((p, pi) => (
            <div key={p.name + pi} className="palette">
              <div className="palette-head">
                <span>{p.name}</span>
                <button
                  className="link"
                  onClick={() => {
                    const next = all.map((q, qi) => (qi === pi ? { ...q, colors: [...q.colors, color] } : q));
                    setPalettes(next);
                  }}
                >
                  + add current
                </button>
              </div>
              <div className="swatches">
                {p.colors.map((c, i) => (
                  <button key={i} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
                ))}
              </div>
            </div>
          ))}
          <button className="btn" onClick={() => setPalettes([...all, { name: `Palette ${all.length + 1}`, colors: [color] }])}>
            New palette
          </button>
          <button
            className="btn"
            onClick={async () => {
              const [f] = await pickFile(""); // any type: iOS greys out .swatches
              if (!f) return;
              try {
                const { importSwatches } = await import("../lib/procreate");
                const p = await importSwatches(f);
                setPalettes([...all, p]);
              } catch (e) {
                alert("Import failed: " + (e as Error).message);
              }
            }}
          >
            Import Procreate palette (.swatches)
          </button>
        </div>
      )}
      {history.length > 0 && (
        <>
          <div className="mini-label">History</div>
          <div className="swatches">
            {history.map((c, i) => (
              <button key={i} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
