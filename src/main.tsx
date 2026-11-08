import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Doc } from "./lib/model";
import { Library } from "./components/Library";
import { Editor } from "./components/Editor";
import { requestPersistence } from "./lib/storage";
import "./style.css";

function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem("dn.theme") || "dark";
    void requestPersistence();
  }, []);
  return doc ? <Editor key={doc.id} doc={doc} onClose={() => setDoc(null)} /> : <Library onOpen={setDoc} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A page opened before a redeploy asks for chunk files that no longer exist (their names change on
// every build): reload once to get the current version instead of failing (e.g. PDF import).
window.addEventListener("vite:preloadError", (e) => {
  const last = Number(sessionStorage.getItem("dn.reloadedAt") || 0);
  if (Date.now() - last < 30_000) return; // already tried: let the error show instead of looping
  e.preventDefault();
  sessionStorage.setItem("dn.reloadedAt", String(Date.now()));
  location.reload();
});

if ("serviceWorker" in navigator && import.meta.env.PROD && !(window as unknown as { Capacitor?: unknown }).Capacitor) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}
