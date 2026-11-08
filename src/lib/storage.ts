// IndexedDB persistence: documents (JSON), folders, and raster layer pixels (PNG blobs keyed by
// "pageId/layerId"). Everything stays on the device; backups are exported as one JSON file.
import type { Doc, Folder } from "./model";

const DB = "drawnote";
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("folders")) db.createObjectStore("folders", { keyPath: "id" });
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        let result: T;
        if (r) r.onsuccess = () => (result = r.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const listDocs = () => tx<Doc[]>("docs", "readonly", (s) => s.getAll());
export const getDoc = (id: string) => tx<Doc | undefined>("docs", "readonly", (s) => s.get(id));
export const putDoc = (d: Doc) => tx<IDBValidKey>("docs", "readwrite", (s) => s.put(d));
export const listFolders = () => tx<Folder[]>("folders", "readonly", (s) => s.getAll());
export const putFolder = (f: Folder) => tx<IDBValidKey>("folders", "readwrite", (s) => s.put(f));
export const deleteFolder = (id: string) => tx<undefined>("folders", "readwrite", (s) => s.delete(id));

export const getBlob = (key: string) => tx<Blob | undefined>("blobs", "readonly", (s) => s.get(key));
export const putBlob = (key: string, b: Blob) => tx<IDBValidKey>("blobs", "readwrite", (s) => s.put(b, key));
export const deleteBlob = (key: string) => tx<undefined>("blobs", "readwrite", (s) => s.delete(key));

// Settings too large for localStorage (e.g. imported brushes with textures) share the blobs store.
export const getValue = <T>(key: string) => tx<T | undefined>("blobs", "readonly", (s) => s.get(key));
export const putValue = (key: string, v: unknown) => tx<IDBValidKey>("blobs", "readwrite", (s) => s.put(v, key));

export function layerKey(pageId: string, layerId: string): string {
  return `${pageId}/${layerId}`;
}

export async function deleteDocForever(d: Doc): Promise<void> {
  for (const p of d.pages) for (const l of p.layers) await deleteBlob(layerKey(p.id, l.id)).catch(() => undefined);
  await tx<undefined>("docs", "readwrite", (s) => s.delete(d.id));
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}
async function dataUrlToBlob(u: string): Promise<Blob> {
  return (await fetch(u)).blob();
}

interface Backup {
  app: "drawnote";
  version: 1;
  exportedAt: number;
  docs: Doc[];
  folders: Folder[];
  layers: Record<string, string>;
}

export async function exportBackup(docs?: Doc[]): Promise<Blob> {
  const all = docs ?? (await listDocs());
  const layers: Record<string, string> = {};
  for (const d of all)
    for (const p of d.pages)
      for (const l of p.layers) {
        const k = layerKey(p.id, l.id);
        const b = await getBlob(k);
        if (b) layers[k] = await blobToDataUrl(b);
      }
  const backup: Backup = { app: "drawnote", version: 1, exportedAt: Date.now(), docs: all, folders: await listFolders(), layers };
  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

/** Adds the backup's documents to the library. Existing documents with the same id are kept and the
 * imported copy gets a new id, so a restore never overwrites newer work. */
export async function importBackup(file: Blob): Promise<number> {
  const data = JSON.parse(await file.text()) as Backup;
  if (data.app !== "drawnote" || !Array.isArray(data.docs)) throw new Error("Not a DrawNote backup file");
  const existing = new Set((await listDocs()).map((d) => d.id));
  const folders = new Set((await listFolders()).map((f) => f.id));
  for (const f of data.folders ?? []) if (!folders.has(f.id)) await putFolder(f);
  let n = 0;
  for (const d of data.docs) {
    const copy: Doc = JSON.parse(JSON.stringify(d));
    if (existing.has(copy.id)) copy.id = copy.id + "-r" + Date.now().toString(36);
    for (const p of copy.pages) {
      const oldPage = p.id;
      if (copy.id !== d.id) p.id = p.id + "r" + Math.random().toString(36).slice(2, 6);
      for (const l of p.layers) {
        const u = data.layers[layerKey(oldPage, l.id)];
        if (u) await putBlob(layerKey(p.id, l.id), await dataUrlToBlob(u));
      }
    }
    await putDoc(copy);
    n++;
  }
  return n;
}

export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* optional */
  }
}
