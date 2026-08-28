import "server-only";
import type { ReaderDocument } from "@/lib/contracts";
import { documentIdFor } from "@/lib/ids";
import { extractGraph, extractPdf, ReadablePdfError } from "@/lib/extraction";
import { clearDocumentContent, insertGraph, insertPassages, readGraph, readPassages } from "@/lib/clickhouse";
import { setDocumentStatus, upsertDocument } from "@/lib/postgres";
import { assertEvidenceBoundGraph, buildVerifiedGraph, getVerifiedProfile, getVerifiedProfileById } from "@/lib/verified-profile";

export async function ingestPdf(input: { buffer: Uint8Array; filename: string; mimeType: string }): Promise<ReaderDocument> {
  const documentId = documentIdFor(input.buffer);
  let profile = getVerifiedProfile(input.buffer);
  const displayTitle = profile?.title || input.filename.replace(/\.pdf$/i, "").slice(0, 160) || "Uploaded document";
  await upsertDocument({ documentId, originalFilename: input.filename.slice(0, 255), displayTitle, mimeType: input.mimeType, fileSize: input.buffer.byteLength });
  try {
    await setDocumentStatus(documentId, "extracting");
    const extraction = await extractPdf(input.buffer, documentId, profile ? {
      evidencePages: profile.evidencePages,
      chapterStarts: profile.chapterStarts,
      profileId: profile.id,
    } : undefined);
    profile ||= getVerifiedProfileById(extraction.verifiedProfileId);
    await setDocumentStatus(documentId, "analyzing", { pageCount: extraction.pageCount, processedPageCount: extraction.processedPageCount });
    const graph = profile ? buildVerifiedGraph(documentId, extraction.passages) : extractGraph(documentId, extraction.passages);
    assertEvidenceBoundGraph(graph, extraction.passages, profile?.requiredNodeLabels);
    await clearDocumentContent(documentId);
    await insertPassages(documentId, extraction.passages);
    await insertGraph(documentId, graph);
    const verified = await readGraph(documentId);
    try {
      assertEvidenceBoundGraph(verified, extraction.passages, profile?.requiredNodeLabels);
    } catch {
      throw new ReadablePdfError("ANALYSIS_FAILED", "We extracted text but could not build a fully supported reading graph.");
    }
    await setDocumentStatus(documentId, "ready", { pageCount: extraction.pageCount, processedPageCount: extraction.processedPageCount });
    const notice = profile
      ? `Verified demo PDF recognized. ReadAid skipped front matter, preserved real page numbers, and added vetted evidence windows for the Marilyn and Lydia question.`
      : extraction.firstContentPage > 1
      ? `ReadAid skipped likely front matter and started at PDF page ${extraction.firstContentPage}. ${extraction.processedPageCount} content page${extraction.processedPageCount === 1 ? " was" : "s were"} processed.`
      : extraction.pageCount > extraction.processedPageCount
        ? `For this demo, ${extraction.processedPageCount} content page${extraction.processedPageCount === 1 ? " was" : "s were"} processed.`
        : undefined;
    return { documentId, title: displayTitle, status: "ready", pageCount: extraction.pageCount, prepared: false, passages: extraction.passages, graph: verified, notice };
  } catch (error) {
    const code = error instanceof ReadablePdfError ? error.code : "PROCESSING_FAILED";
    const message = error instanceof ReadablePdfError ? error.message : "We could not process this PDF. Please try another text-based file or load the prepared example.";
    await setDocumentStatus(documentId, "failed", { errorCode: code, errorMessage: message }).catch(() => undefined);
    throw new ReadablePdfError(code, message);
  }
}

export async function loadStoredDocument(documentId: string, title: string, pageCount: number): Promise<ReaderDocument> {
  const [passages, graph] = await Promise.all([readPassages(documentId), readGraph(documentId)]);
  return { documentId, title, status: "ready", pageCount, prepared: false, passages, graph };
}
