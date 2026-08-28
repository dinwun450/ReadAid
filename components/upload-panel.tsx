"use client";

import { useRef, useState } from "react";
import { MAX_UPLOAD_BYTES, type ReaderDocument } from "@/lib/contracts";

export function UploadPanel({ onLoaded, onBusy }: { onLoaded: (document: ReaderDocument) => void; onBusy: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") { setMessage("Choose a PDF file."); return; }
    if (file.size === 0) { setMessage("This PDF is empty."); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setMessage("This PDF is larger than 15 MB."); return; }
    onBusy(true);
    setMessage("Uploading and finding the story...");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The PDF could not be processed.");
      onLoaded(data.document);
      setMessage(`${file.name} is ready.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The PDF could not be processed.");
    } finally {
      onBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      className={`drop-zone ${dragging ? "dragging" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files[0]); }}
    >
      <input ref={inputRef} id="pdf-upload" className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => void upload(event.target.files?.[0])} />
      <div><span className="upload-icon" aria-hidden="true">PDF</span><strong>Drop a PDF here</strong><small>Text-based PDF - one file - up to 15 MB</small></div>
      <button className="secondary-button compact" type="button" onClick={() => inputRef.current?.click()}>Choose PDF</button>
      <p className="upload-status" role="status" aria-live="polite">{message}</p>
    </div>
  );
}
