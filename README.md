# DrawNote

**สมุดโน้ต + สตูดิโอวาดภาพ ในแอปเดียว ใช้บนมือถือได้** · A notebook and a painting studio in one mobile-first app.

DrawNote combines the two projects you asked for:

| From | What DrawNote has |
|---|---|
| [goodnotes-dupe](https://github.com/atratheking/goodnotes-dupe) (Goodnotes-style notebooks) | Library with folders, favorites, search, sort and recoverable Trash · notebooks with 10 paper templates (blank, ruled, narrow, grid, dotted, isometric, Cornell, to-do, music, weekly planner), paper colours, A4/Letter/Phone, portrait/landscape, cover colours · pen, fountain pen, pencil, highlighter · partial (stroke-splitting) and whole-stroke eraser · lasso select / move / resize / duplicate / recolour / delete · text boxes (Thai works), shapes (rect, ellipse, triangle, line, arrow), sticky notes, tape (tap to reveal), images, laser pointer · page add / duplicate / reorder / delete, bookmarks, page thumbnails · PDF import (annotate, text is searchable) and PDF export · read-only mode · JSON backup / restore |
| [ProCraft](https://github.com/artcraft-android/procraft) (Procreate-style painting) | Stamp brush engine with pressure, StreamLine, taper, hardness, spacing, scatter, jitter, tip shapes, paper/canvas/charcoal grain, colour dynamics, wet edges · 36 brushes in 12 sets (Sketching, Inking, Drawing, Painting, Watercolour, Calligraphy, Airbrushing, Spray Paint, Charcoals, Textures, Abstract, Erasers) · Brush Studio to edit and save your own brushes · smudge and eraser with any brush · layers with 17 blend modes, opacity, alpha lock, clipping masks, lock, duplicate, merge down, reorder · colour Disc / Classic / Harmony / Value / Palettes + history + eyedropper · ColorDrop fill with threshold and gap closing · selection (freehand, rectangle, ellipse, feather, invert, copy/cut to layer, fill, clear) · transform (move, scale, rotate, flip, fit, snap) · 17 adjustments (HSB, brightness/contrast, colour balance, curves, gradient map, gaussian/motion blur, sharpen, noise, bloom, glitch, halftone, chromatic aberration, posterize, threshold, invert, grayscale) · QuickShape (hold to snap line/circle/rect/triangle) · symmetry guides (vertical, horizontal, quadrant, radial) and grid guide · Animation Assist (layers as frames, onion skin, FPS, video export) · time-lapse replay and video export · reference window · flip canvas · export PNG / JPEG / PDF / PNG per layer · gestures: pinch zoom & rotate, two-finger tap undo, three-finger tap redo |

### How the two work together

Every page — in a notebook **or** a canvas — has both systems:
**raster paint layers** (ProCraft side) underneath a **vector notes layer** (Goodnotes side).
Switch with the **Notes / Paint** toggle at the top of the editor. Painting under handwritten notes, highlighting over a painting,
annotating an imported PDF with watercolour, or flattening selected notes into a paint layer ("To paint") all work on the same page.
Colour, palettes, undo/redo, layers, pages and export are shared.

## ใช้บนมือถือ (Use it on your phone)

1. **Web app (ง่ายที่สุด):** เปิด GitHub Pages ของ repo นี้ในมือถือ แล้วกด *Share → Add to Home Screen* (iPhone) หรือ *⋮ → Install app* (Android)
   แอปจะเปิดเต็มจอและใช้งานออฟไลน์ได้ ข้อมูลเก็บในเครื่อง (IndexedDB)
   — To turn this on once: repo **Settings → Pages → Source: GitHub Actions**. The `Deploy web app` workflow publishes every push.
2. **Android APK:** run the **Build Android APK** workflow (Actions tab → *Run workflow*) and download the APK artifact,
   or locally with Android Studio: `npm run android:init` then `npm run android:open`.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173 (also reachable from your phone on the same Wi-Fi)
npm test           # unit tests (geometry, fill, adjustments, colour, model)
npm run build      # production build in dist/
```

Stack: React 19 + TypeScript + Vite, Canvas 2D, pdf.js / pdf-lib, Capacitor for the Android wrapper. No server; all data stays on the device.

## Honest scope

DrawNote is a **new app written from scratch** that brings the two projects' features together; it does not contain their code.
(ProCraft is MIT/Apache-2.0; goodnotes-dupe has no licence file, so its code was used only as a feature reference.)
ProCraft's engine is ~157k lines of Rust with a GPU renderer; DrawNote re-implements its features on Canvas 2D, so some deep parts are simplified or not included:

- Not included: 3D painting (OBJ/USDZ), liquify, warp/distort mesh transform, PSD / TIFF / GIF import-export, Photoshop .abr brushes, ibisPaint brushes/palettes (ibisPaint shares these only as QR codes in an undocumented format), the plugin system, perspective drawing assist, text on paint layers, Goodnotes Web account mode, cloud sync / collaboration / AI / handwriting recognition / audio.
- Procreate import: brushes (`.brush`, `.brushset` — name, spacing, jitter, StreamLine, size, pressure, taper, colour jitter, shape and grain images) and palettes (`.swatches`). Pressure curves, wet mix, dual brushes and rendering modes are not mapped.
- Simplified: wet mix is approximated (wet edges + smudge), adjustments are applied on the CPU (large canvases take a moment), time-lapse records a frame per change rather than every stroke sample, layer memory limits large canvases on phones (max 4096 px).
