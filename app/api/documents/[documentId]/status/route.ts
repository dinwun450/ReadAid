import { NextResponse } from "next/server";
import { getDocument } from "@/lib/postgres";
import { PREPARED_DOCUMENT_ID, preparedDocument } from "@/lib/prepared";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await context.params;
  if (documentId === PREPARED_DOCUMENT_ID) return NextResponse.json({ documentId, status: preparedDocument.status, pageCount: preparedDocument.pageCount });
  try {
    const document = await getDocument(documentId);
    if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    return NextResponse.json({ documentId: document.document_id, status: document.status, pageCount: document.page_count, processedPageCount: document.processed_page_count, errorCode: document.error_code, errorMessage: document.error_message });
  } catch {
    return NextResponse.json({ error: "Status is temporarily unavailable." }, { status: 503 });
  }
}

