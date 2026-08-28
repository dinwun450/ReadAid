import { NextResponse } from "next/server";
import { insertGraph, insertPassages } from "@/lib/clickhouse";
import { preparedDocument } from "@/lib/prepared";
import { setDocumentStatus, upsertDocument } from "@/lib/postgres";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ document: preparedDocument });
}

export async function POST() {
  let notice = preparedDocument.notice;
  try {
    await upsertDocument({ documentId: preparedDocument.documentId, originalFilename: "prepared-example.pdf", displayTitle: preparedDocument.title, mimeType: "application/pdf", fileSize: 0 });
    await setDocumentStatus(preparedDocument.documentId, "analyzing", { pageCount: preparedDocument.pageCount, processedPageCount: preparedDocument.pageCount });
    await insertPassages(preparedDocument.documentId, preparedDocument.passages);
    await insertGraph(preparedDocument.documentId, preparedDocument.graph);
    await setDocumentStatus(preparedDocument.documentId, "ready", { pageCount: preparedDocument.pageCount, processedPageCount: preparedDocument.pageCount });
  } catch {
    notice = "Prepared demo data is active locally because a document service was unavailable.";
  }
  return NextResponse.json({ document: { ...preparedDocument, notice } });
}

