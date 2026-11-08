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

if ("serviceWorker" in navigator && import.meta.env.PROD && !(window as unknown as { Capacitor?: unknown }).Capacitor) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}
