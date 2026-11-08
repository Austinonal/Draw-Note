import { useEffect, useMemo, useState } from "react";
import { BookOpen, Folder as FolderIcon, FolderPlus, Heart, Plus, Search, Settings, Star, Trash2, Palette, FileText, Image as ImageIcon, Upload, Download, RotateCcw, Menu, X } from "lucide-react";
import type { Doc, Folder, Paper, PageSize } from "../lib/model";
import { CANVAS_PRESETS, COVERS, PAPERS, PAPER_COLORS, docSearchText, id, newCanvasDoc, newNotebook, isDark } from "../lib/model";
import { deleteDocForever, deleteFolder, exportBackup, importBackup, listDocs, listFolders, putDoc, putFolder } from "../lib/storage";
import { drawPaper } from "../lib/paper";
import { Seg, Sheet, Toggle, pickFile, readAsDataUrl, shareOrDownload } from "./ui";
import { loadImage } from "../lib/render";
import { newLayer } from "../lib/model";
import { putBlob, layerKey } from "../lib/storage";

type Filter = { kind: "all" } | { kind: "favorites" } | { kind: "trash" } | { kind: "folder"; id: string } | { kind: "notebooks" } | { kind: "canvases" };
type Sort = "updated" | "created" | "title";

function PaperThumb({ paper, color, landscape }: { paper: Paper; color: string; landscape?: boolean }) {
  return (
    <canvas
      className="paper-thumb"
      width={landscape ? 120 : 92}
      height={landscape ? 92 : 120}
      ref={(c) => {
        if (!c) return;
        const g = c.getContext("2d")!;
        const w = landscape ? 1123 : 794,
          h = landscape ? 794 : 1123;
        g.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
        drawPaper(g, paper, w, h, color);
      }}
    />
  );
}

export function Library({ onOpen }: { onOpen: (d: Doc) => void }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem("dn.sort") as Sort) || "updated");
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<null | "new" | "notebook" | "canvas" | "settings" | "folder">(null);
  const [menu, setMenu] = useState<Doc | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [side, setSide] = useState(false);

  const refresh = async () => {
    setDocs(await listDocs());
    setFolders(await listFolders());
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("dn.sort", sort);
    } catch {
      /* ignore */
    }
  }, [sort]);

  const folderId = filter.kind === "folder" ? filter.id : null;
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return docs
      .filter((d) => (filter.kind === "trash" ? d.trashed : !d.trashed))
      .filter((d) => (filter.kind === "favorites" ? d.favorite : filter.kind === "folder" ? d.folderId === filter.id : filter.kind === "notebooks" ? d.kind === "notebook" : filter.kind === "canvases" ? d.kind === "canvas" : true))
      .filter((d) => !ql || docSearchText(d).includes(ql))
      .sort((a, b) => (sort === "title" ? a.title.localeCompare(b.title) : sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt));
  }, [docs, filter, q, sort]);

  const update = async (d: Doc, patch: Partial<Doc>) => {
    Object.assign(d, patch);
    await putDoc(d);
    await refresh();
  };

  const create = async (d: Doc) => {
    await putDoc(d);
    setSheet(null);
    onOpen(d);
  };

  const importPdfDoc = async () => {
    const [f] = await pickFile("application/pdf");
    if (!f) return;
    setBusy("Importing PDF…");
    try {
      const { importPdf } = await import("../lib/pdf");
      const pages = await importPdf(f, (a, b) => setBusy(`Importing PDF… ${a}/${b}`));
      const d = newNotebook(f.name.replace(/\.pdf$/i, ""), { paper: "blank", paperColor: "#ffffff", size: "a4", landscape: false, cover: COVERS[Math.floor(Math.random() * COVERS.length)], folderId });
      d.pages = pages;
      await putDoc(d);
      setBusy(null);
      setSheet(null);
      onOpen(d);
    } catch (e) {
      setBusy(null);
      alert("Could not import this PDF: " + (e as Error).message);
    }
  };

  const importImageDoc = async () => {
    const [f] = await pickFile("image/*");
    if (!f) return;
    const url = await readAsDataUrl(f);
    const img = await loadImage(url);
    const k = Math.min(1, 4096 / Math.max(img.width, img.height));
    const w = Math.round(img.width * k),
      h = Math.round(img.height * k);
    const d = newCanvasDoc(f.name.replace(/\.[^.]+$/, ""), w, h, "#ffffff", folderId);
    const page = d.pages[0];
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const photo = newLayer("Photo");
    page.layers = [photo, ...page.layers];
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
    await putBlob(layerKey(page.id, photo.id), blob);
    await create(d);
  };

  const navItem = (f: Filter, label: string, icon: React.ReactNode, count?: number) => {
    const on = JSON.stringify(f) === JSON.stringify(filter);
    return (
      <button className={"nav-item" + (on ? " on" : "")} onClick={() => (setFilter(f), setSide(false))}>
        {icon}
        <span>{label}</span>
        {count !== undefined && <small>{count}</small>}
      </button>
    );
  };

  const live = docs.filter((d) => !d.trashed);
  const titleOf = filter.kind === "folder" ? folders.find((f) => f.id === filter.id)?.name ?? "Folder" : { all: "Documents", favorites: "Favorites", trash: "Trash", notebooks: "Notebooks", canvases: "Canvases" }[filter.kind];

  return (
    <div className="library">
      <aside className={"lib-side" + (side ? " open" : "")}>
        <div className="brand">
          <img src="./icon.svg" alt="" width={28} height={28} />
          <b>DrawNote</b>
          <button className="icon-btn sm only-phone" onClick={() => setSide(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        {navItem({ kind: "all" }, "All documents", <BookOpen size={18} />, live.length)}
        {navItem({ kind: "notebooks" }, "Notebooks", <FileText size={18} />, live.filter((d) => d.kind === "notebook").length)}
        {navItem({ kind: "canvases" }, "Canvases", <Palette size={18} />, live.filter((d) => d.kind === "canvas").length)}
        {navItem({ kind: "favorites" }, "Favorites", <Star size={18} />, live.filter((d) => d.favorite).length)}
        <div className="nav-label">
          Folders
          <button className="icon-btn sm" onClick={() => setSheet("folder")} aria-label="New folder">
            <FolderPlus size={16} />
          </button>
        </div>
        {folders.map((f) => (
          <div key={f.id} className="folder-row">
            {navItem({ kind: "folder", id: f.id }, f.name, <FolderIcon size={18} color={f.color} />, live.filter((d) => d.folderId === f.id).length)}
            <button
              className="icon-btn sm"
              aria-label="Delete folder"
              onClick={async () => {
                if (!confirm(`Delete folder "${f.name}"? Its documents move to All documents.`)) return;
                for (const d of docs.filter((d) => d.folderId === f.id)) await putDoc({ ...d, folderId: null });
                await deleteFolder(f.id);
                setFilter({ kind: "all" });
                await refresh();
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <div className="nav-spacer" />
        {navItem({ kind: "trash" }, "Trash", <Trash2 size={18} />, docs.filter((d) => d.trashed).length)}
        <button className="nav-item" onClick={() => setSheet("settings")}>
          <Settings size={18} />
          <span>Settings &amp; backup</span>
        </button>
      </aside>
      {side && <div className="lib-scrim" onClick={() => setSide(false)} />}

      <main className="lib-main">
        <header className="lib-head">
          <button className="icon-btn only-phone" onClick={() => setSide(true)} aria-label="Menu">
            <Menu size={22} />
          </button>
          <h1>{titleOf}</h1>
          <div className="search">
            <Search size={16} />
            <input placeholder="Search titles, typed text, PDFs" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="updated">Last edited</option>
            <option value="created">Date created</option>
            <option value="title">Name</option>
          </select>
        </header>

        {filter.kind === "trash" && shown.length > 0 && (
          <div className="trash-bar">
            <span>Documents in Trash can be restored or deleted forever.</span>
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm("Delete everything in Trash forever?")) return;
                for (const d of shown) await deleteDocForever(d);
                await refresh();
              }}
            >
              Empty Trash
            </button>
          </div>
        )}

        <div className="grid">
          {filter.kind !== "trash" && (
            <button className="card new-card" onClick={() => setSheet("new")}>
              <div className="cover new">
                <Plus size={36} />
              </div>
              <span className="card-title">New</span>
            </button>
          )}
          {shown.map((d) => (
            <div key={d.id} className="card">
              <button className="cover-btn" onClick={() => (filter.kind === "trash" ? setMenu(d) : onOpen(d))} onContextMenu={(e) => (e.preventDefault(), setMenu(d))}>
                {d.kind === "notebook" ? (
                  <div className="cover notebook" style={{ background: d.cover }}>
                    {d.thumb && <img src={d.thumb} alt="" />}
                    <i className="spine" />
                  </div>
                ) : (
                  <div className="cover canvas">{d.thumb ? <img src={d.thumb} alt="" /> : <Palette size={32} />}</div>
                )}
              </button>
              <div className="card-meta">
                <span className="card-title">{d.title}</span>
                <small>
                  {d.kind === "canvas" ? `${d.pages[0].w}×${d.pages[0].h}` : `${d.pages.length} page${d.pages.length > 1 ? "s" : ""}`} · {new Date(d.updatedAt).toLocaleDateString()}
                </small>
              </div>
              <div className="card-actions">
                <button className={"icon-btn sm" + (d.favorite ? " fav" : "")} onClick={() => update(d, { favorite: !d.favorite })} aria-label="Favorite">
                  <Heart size={16} fill={d.favorite ? "currentColor" : "none"} />
                </button>
                <button className="icon-btn sm" onClick={() => setMenu(d)} aria-label="More">
                  ⋯
                </button>
              </div>
            </div>
          ))}
        </div>
        {!shown.length && filter.kind !== "all" && <p className="empty">{q ? "No matches." : "Nothing here yet."}</p>}
        {!docs.length && (
          <div className="welcome">
            <h2>Welcome to DrawNote</h2>
            <p>Notebooks with paper templates, handwriting, text, shapes and PDFs — and a full painting studio with brushes, layers, blend modes and adjustments. Every page has both: switch between <b>Notes</b> and <b>Paint</b> at the top of the editor.</p>
            <p className="hint">Tip: add DrawNote to your home screen (Share → Add to Home Screen) to use it full screen and offline.</p>
          </div>
        )}
      </main>

      <button className="fab only-phone" onClick={() => setSheet("new")} aria-label="New">
        <Plus size={26} />
      </button>

      {sheet === "new" && (
        <Sheet title="Create" onClose={() => setSheet(null)}>
          <div className="create-grid">
            <button onClick={() => setSheet("notebook")}>
              <FileText size={28} />
              <b>Notebook</b>
              <small>Pages, paper templates, handwriting</small>
            </button>
            <button onClick={() => setSheet("canvas")}>
              <Palette size={28} />
              <b>Canvas</b>
              <small>Painting with brushes and layers</small>
            </button>
            <button onClick={importPdfDoc}>
              <Upload size={28} />
              <b>Import PDF</b>
              <small>Annotate and search it</small>
            </button>
            <button onClick={importImageDoc}>
              <ImageIcon size={28} />
              <b>Import photo</b>
              <small>Paint over an image</small>
            </button>
          </div>
        </Sheet>
      )}
      {sheet === "notebook" && <NewNotebook folderId={folderId} onCreate={create} onClose={() => setSheet(null)} />}
      {sheet === "canvas" && <NewCanvas folderId={folderId} onCreate={create} onClose={() => setSheet(null)} />}
      {sheet === "folder" && (
        <NewFolder
          onClose={() => setSheet(null)}
          onCreate={async (f) => {
            await putFolder(f);
            setSheet(null);
            await refresh();
          }}
        />
      )}
      {sheet === "settings" && <SettingsSheet onClose={() => setSheet(null)} onRestored={refresh} />}
      {menu && (
        <Sheet title={menu.title} onClose={() => setMenu(null)}>
          <div className="menu-list">
            {menu.trashed ? (
              <>
                <button onClick={async () => (await update(menu, { trashed: false }), setMenu(null))}>
                  <RotateCcw size={18} /> Restore
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    if (!confirm("Delete forever? This cannot be undone.")) return;
                    await deleteDocForever(menu);
                    setMenu(null);
                    await refresh();
                  }}
                >
                  <Trash2 size={18} /> Delete forever
                </button>
              </>
            ) : (
              <>
                <button onClick={() => (setMenu(null), onOpen(menu))}>
                  <BookOpen size={18} /> Open
                </button>
                <label className="field">
                  Rename
                  <input defaultValue={menu.title} onBlur={(e) => update(menu, { title: e.target.value.trim() || "Untitled" })} />
                </label>
                <label className="field">
                  Move to folder
                  <select value={menu.folderId ?? ""} onChange={(e) => update(menu, { folderId: e.target.value || null })}>
                    <option value="">— None —</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                {menu.kind === "notebook" && (
                  <div className="field">
                    Cover
                    <div className="swatches">
                      {COVERS.map((c) => (
                        <button key={c} className={menu.cover === c ? "on" : ""} style={{ background: c }} onClick={() => update(menu, { cover: c })} aria-label={c} />
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={async () => (await update(menu, { favorite: !menu.favorite }), setMenu(null))}>
                  <Star size={18} /> {menu.favorite ? "Remove from favorites" : "Add to favorites"}
                </button>
                <button onClick={async () => shareOrDownload(await exportBackup([menu]), `${menu.title}.drawnote.json`)}>
                  <Download size={18} /> Export DrawNote file
                </button>
                <button className="danger" onClick={async () => (await update(menu, { trashed: true }), setMenu(null))}>
                  <Trash2 size={18} /> Move to Trash
                </button>
              </>
            )}
          </div>
        </Sheet>
      )}
      {busy && <div className="busy">{busy}</div>}
    </div>
  );
}

function NewNotebook({ folderId, onCreate, onClose }: { folderId: string | null; onCreate: (d: Doc) => void; onClose: () => void }) {
  const [title, setTitle] = useState("Untitled notebook");
  const [paper, setPaper] = useState<Paper>("ruled");
  const [color, setColor] = useState(PAPER_COLORS[0]);
  const [cover, setCover] = useState(COVERS[0]);
  const [size, setSize] = useState<PageSize>("a4");
  const [landscape, setLandscape] = useState(false);
  return (
    <Sheet
      title="New notebook"
      wide
      onClose={onClose}
      actions={
        <button className="btn primary" onClick={() => onCreate(newNotebook(title.trim() || "Untitled", { paper, paperColor: color, size, landscape, cover, folderId }))}>
          Create
        </button>
      }
    >
      <label className="field">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus onFocus={(e) => e.target.select()} />
      </label>
      <div className="field">
        Cover
        <div className="swatches">
          {COVERS.map((c) => (
            <button key={c} className={cover === c ? "on" : ""} style={{ background: c }} onClick={() => setCover(c)} aria-label={c} />
          ))}
        </div>
      </div>
      <div className="row gap wrap">
        <Seg value={size} onChange={setSize} options={[{ id: "a4", label: "A4" }, { id: "letter", label: "Letter" }, { id: "phone", label: "Phone" }]} />
        <Toggle label="Landscape" checked={landscape} onChange={setLandscape} />
      </div>
      <div className="field">
        Paper colour
        <div className="swatches">
          {PAPER_COLORS.map((c) => (
            <button key={c} className={color === c ? "on" : ""} style={{ background: c, borderColor: isDark(c) ? "#555" : undefined }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
      </div>
      <div className="paper-grid">
        {PAPERS.map((p) => (
          <button key={p.id} className={paper === p.id ? "on" : ""} onClick={() => setPaper(p.id)}>
            <PaperThumb paper={p.id} color={color} landscape={landscape} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function NewCanvas({ folderId, onCreate, onClose }: { folderId: string | null; onCreate: (d: Doc) => void; onClose: () => void }) {
  const screen = { w: Math.round(window.screen.width * Math.min(2, devicePixelRatio)), h: Math.round(window.screen.height * Math.min(2, devicePixelRatio)) };
  const [w, setW] = useState(2048);
  const [h, setH] = useState(2048);
  const [bg, setBg] = useState("#ffffff");
  const [title, setTitle] = useState("Untitled artwork");
  const mp = (w * h) / 1e6;
  return (
    <Sheet
      title="New canvas"
      onClose={onClose}
      actions={
        <button className="btn primary" onClick={() => onCreate(newCanvasDoc(title.trim() || "Untitled", w, h, bg, folderId))}>
          Create
        </button>
      }
    >
      <label className="field">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="preset-list">
        {CANVAS_PRESETS.map((p) => {
          const pw = p.w || Math.min(4096, screen.w),
            ph = p.h || Math.min(4096, screen.h);
          return (
            <button key={p.name} className={w === pw && h === ph ? "on" : ""} onClick={() => (setW(pw), setH(ph))}>
              <b>{p.name}</b>
              <small>
                {pw} × {ph}
              </small>
            </button>
          );
        })}
      </div>
      <div className="row gap">
        <label className="field">
          Width
          <input type="number" min={64} max={4096} value={w} onChange={(e) => setW(Number(e.target.value))} />
        </label>
        <label className="field">
          Height
          <input type="number" min={64} max={4096} value={h} onChange={(e) => setH(Number(e.target.value))} />
        </label>
        <label className="field">
          Background
          <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
        </label>
      </div>
      <p className="hint">
        {mp.toFixed(1)} megapixels. Each layer uses about {Math.round(mp * 4)} MB of memory; phones handle about 8–20 layers at 2048².
      </p>
    </Sheet>
  );
}

function NewFolder({ onCreate, onClose }: { onCreate: (f: Folder) => void; onClose: () => void }) {
  const [name, setName] = useState("New folder");
  const [color, setColor] = useState(COVERS[0]);
  return (
    <Sheet title="New folder" onClose={onClose} actions={<button className="btn primary" onClick={() => onCreate({ id: id(), name: name.trim() || "Folder", color })}>Create</button>}>
      <label className="field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onFocus={(e) => e.target.select()} />
      </label>
      <div className="swatches">
        {COVERS.map((c) => (
          <button key={c} className={color === c ? "on" : ""} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
      </div>
    </Sheet>
  );
}

function SettingsSheet({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const [msg, setMsg] = useState("");
  const [usage, setUsage] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("dn.theme") || "dark");
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage ?? 0) / 1e6).toFixed(1)} MB used of ${((e.quota ?? 0) / 1e9).toFixed(1)} GB available`));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("dn.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return (
    <Sheet title="Settings & backup" onClose={onClose}>
      <div className="field">
        Theme
        <Seg value={theme} onChange={setTheme} options={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }]} />
      </div>
      <div className="menu-list">
        <button onClick={async () => shareOrDownload(await exportBackup(), `DrawNote backup ${new Date().toISOString().slice(0, 10)}.json`)}>
          <Download size={18} /> Export full library backup
        </button>
        <button
          onClick={async () => {
            const [f] = await pickFile("application/json,.json");
            if (!f) return;
            try {
              const n = await importBackup(f);
              setMsg(`Restored ${n} document${n === 1 ? "" : "s"}.`);
              onRestored();
            } catch (e) {
              setMsg("Restore failed: " + (e as Error).message);
            }
          }}
        >
          <Upload size={18} /> Restore from backup (adds to library)
        </button>
      </div>
      {msg && <p className="hint">{msg}</p>}
      <p className="hint">{usage}</p>
      <p className="hint">Everything is stored on this device only (IndexedDB). Export backups regularly — clearing browser data deletes the library.</p>
      <p className="hint">
        DrawNote combines a Goodnotes-style notebook (inspired by <i>goodnotes-dupe</i>) with a ProCraft-style painting studio (inspired by <i>ProCraft</i>, MIT/Apache-2.0).
      </p>
    </Sheet>
  );
}

