import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/contracts";
import { ReadablePdfError } from "@/lib/extraction";
import { ingestPdf } from "@/lib/ingestion";

export const runtime = "nodejs";
export const maxDuration = 60;

function error(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  let bytes: Uint8Array | undefined;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return error("Choose one PDF to upload.", 400, "FILE_REQUIRED");
    if (!file.name.toLowerCase().endsWith(".pdf")) return error("Only PDF files are supported.", 415, "INVALID_EXTENSION");
    if (file.type !== "application/pdf") return error("This file does not have the PDF content type.", 415, "INVALID_MIME_TYPE");
    if (file.size === 0) return error("This PDF is empty.", 400, "EMPTY_FILE");
    if (file.size > MAX_UPLOAD_BYTES) return error("This PDF is larger than the 15 MB limit.", 413, "FILE_TOO_LARGE");
    bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-") return error("The file does not have a valid PDF signature.", 415, "INVALID_SIGNATURE");
    const document = await ingestPdf({ buffer: bytes, filename: file.name, mimeType: file.type });
    return NextResponse.json({ document: { ...document, passages: document.passages.slice(0, 3) }, readerUrl: `/?document=${encodeURIComponent(document.documentId)}` });
  } catch (caught) {
    if (caught instanceof ReadablePdfError) return error(caught.message, 422, caught.code);
    return error("We could not process this PDF. Load the prepared example or try another text-based PDF.", 500, "PROCESSING_FAILED");
  } finally {
    bytes = undefined;
  }
}

