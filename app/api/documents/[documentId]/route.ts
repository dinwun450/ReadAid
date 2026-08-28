import { NextResponse } from "next/server";
import { getDocument } from "@/lib/postgres";
import { loadStoredDocument } from "@/lib/ingestion";
import { PREPARED_DOCUMENT_ID, preparedDocument } from "@/lib/prepared";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await context.params;
  if (documentId === PREPARED_DOCUMENT_ID) return NextResponse.json({ document: preparedDocument });
  try {
    const metadata = await getDocument(documentId);
    if (!metadata) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    if (metadata.status !== "ready") return NextResponse.json({ document: metadata });
    const document = await loadStoredDocument(documentId, String(metadata.display_title), Number(metadata.page_count));
    return NextResponse.json({ document: { ...document, passages: document.passages.slice(0, 6) } });
  } catch {
    return NextResponse.json({ error: "This document could not be loaded. The prepared example is still available." }, { status: 503 });
  }
}

