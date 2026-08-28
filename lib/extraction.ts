import "server-only";
import { PDFParse } from "pdf-parse";
import type { GraphEdge, GraphNode, GraphResult, Passage } from "@/lib/contracts";
import { MAX_PROCESS_PAGES, MAX_SCAN_PAGES } from "@/lib/contracts";
import { canonicalize, stableId } from "@/lib/ids";
import { getVerifiedProfileFromMetadata } from "@/lib/verified-profile";

export class ReadablePdfError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const NAME_STOP_WORDS = new Set([
  "the", "this", "that", "when", "where", "what", "why", "how", "chapter", "page", "a", "an",
  "in", "on", "at", "as", "and", "but", "for", "from", "with", "she", "he", "her", "his", "hers",
  "him", "they", "them", "their", "theirs", "we", "our", "you", "your", "i", "it", "its", "then",
  "after", "before", "because", "though", "however", "every", "no", "yes", "of", "to",
]);

type ExtractedPage = { page: number; text: string };
type SelectedPage = ExtractedPage & { chapter: number };
export type PdfExtractionOptions = { evidencePages?: number[]; chapterStarts?: number[]; profileId?: string };
export type PdfExtractionResult = {
  passages: Passage[];
  pageCount: number;
  processedPageCount: number;
  firstContentPage: number;
  chapterDetected: boolean;
  verifiedProfileId?: string;
};

const FRONT_MATTER_HEADING = /^(?:title\s+page|copyright|dedication|epigraph|contents|table\s+of\s+contents|preface|foreword|introduction|acknowledg(?:e)?ments?|about\s+the\s+author|characters?|cast\s+of\s+characters|character\s+(?:list|introductions?)|dramatis\s+personae)\b/i;
const CHAPTER_HEADING = /^(?:chapter\s+(?:\d{1,3}|[ivxlcdm]{1,8}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*[:.—–-].*)?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[ivxlcdm]{1,8})(?:\s*[:.—–-]\s*[^.]{1,80})?)$/i;

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function looksLikeContents(text: string): boolean {
  const lines = nonEmptyLines(text);
  const opening = lines.slice(0, 4).join(" ");
  const chapterReferences = lines.filter((line) => /\bchapter\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(line)).length;
  const dottedEntries = lines.filter((line) => /\.{3,}\s*\d+\s*$/.test(line)).length;
  return /\b(?:table\s+of\s+)?contents\b/i.test(opening) || chapterReferences >= 3 || dottedEntries >= 3;
}

function looksLikeCharacterList(text: string): boolean {
  const lines = nonEmptyLines(text);
  if (FRONT_MATTER_HEADING.test(lines[0] || "") && /character|cast|dramatis/i.test(lines[0] || "")) return true;
  const listEntries = lines.slice(0, 20).filter((line) => /^[A-Z][A-Za-z .'-]{1,35}\s*(?:—|–|-|:)\s*.{3,120}$/.test(line)).length;
  return listEntries >= 4;
}

function chapterHeading(text: string): string | undefined {
  if (looksLikeContents(text)) return undefined;
  const lines = nonEmptyLines(text);
  const candidates = lines.slice(0, 3);
  return candidates.find((line) => CHAPTER_HEADING.test(line.replace(/\s+/g, " ")));
}

export function detectChapterStarts(pages: ExtractedPage[]): number[] {
  return pages.filter((page) => Boolean(chapterHeading(page.text))).map((page) => page.page);
}

function looksLikeFrontMatter(page: ExtractedPage): boolean {
  const lines = nonEmptyLines(page.text);
  const opening = lines.slice(0, 3).join(" ");
  if (!opening) return true;
  if (FRONT_MATTER_HEADING.test(opening) || looksLikeContents(page.text) || looksLikeCharacterList(page.text)) return true;
  if (/\b(?:all rights reserved|isbn|library of congress|printed in|published by)\b/i.test(page.text.slice(0, 1000))) return true;
  const sentenceCount = (page.text.match(/[.!?](?:\s|$)/g) || []).length;
  return page.page <= 8 && page.text.replace(/\s/g, "").length < 220 && sentenceCount < 2;
}

function looksSubstantial(page: ExtractedPage): boolean {
  const compactLength = page.text.replace(/\s/g, "").length;
  const sentenceCount = (page.text.match(/[.!?](?:\s|$)/g) || []).length;
  return compactLength >= 300 || sentenceCount >= 3;
}

/** Selects the first two detected chapters while excluding likely front matter. */
export function selectContentPages(pages: ExtractedPage[], limit = MAX_PROCESS_PAGES): SelectedPage[] {
  const readable = pages.map((page) => ({ ...page, text: page.text.trim() })).filter((page) => page.text.length > 0);
  if (!readable.length) return [];

  const chapterStarts = readable.flatMap((page, index) => chapterHeading(page.text) ? [{ index, page: page.page }] : []);
  if (chapterStarts.length) {
    const startIndex = chapterStarts[0].index;
    const thirdChapterIndex = chapterStarts[2]?.index ?? readable.length;
    let chapter = 1;
    let nextChapterCursor = 1;
    const selected: SelectedPage[] = [];
    for (let index = startIndex; index < thirdChapterIndex && selected.length < limit; index += 1) {
      while (chapterStarts[nextChapterCursor]?.index === index && chapter < 2) {
        chapter += 1;
        nextChapterCursor += 1;
      }
      const page = readable[index];
      if (!looksLikeFrontMatter(page) || chapterHeading(page.text)) selected.push({ ...page, chapter });
    }
    if (selected.length) return selected;
  }

  const substantialIndex = readable.findIndex((page) => !looksLikeFrontMatter(page) && looksSubstantial(page));
  const nonFrontMatterIndex = readable.findIndex((page) => !looksLikeFrontMatter(page));
  const fallbackIndex = readable.findIndex((page) => page.text.replace(/\s/g, "").length >= 40);
  const startIndex = substantialIndex >= 0 ? substantialIndex : nonFrontMatterIndex >= 0 ? nonFrontMatterIndex : Math.max(fallbackIndex, 0);
  return readable.slice(startIndex).filter((page) => !looksLikeFrontMatter(page) || page.page === readable[startIndex]?.page).slice(0, limit).map((page) => ({ ...page, chapter: 1 }));
}

function chunks(text: string, maxLength = 900): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const output: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxLength) {
      output.push(current);
      current = "";
    }
    current = `${current} ${sentence}`.trim();
  }
  if (current) output.push(current);
  return output;
}

export async function extractPdf(
  buffer: Uint8Array,
  documentId: string,
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const pageCount = info.total;
    const metadataProfile = getVerifiedProfileFromMetadata(info.info, pageCount);
    const evidencePages = options.evidencePages || metadataProfile?.evidencePages || [];
    const configuredChapterStarts = options.chapterStarts || metadataProfile?.chapterStarts;
    const scanPageCount = Math.min(pageCount, MAX_SCAN_PAGES);
    const extractedPageMap = new Map<number, ExtractedPage>();
    const batchSize = 20;
    for (let first = 1; first <= scanPageCount; first += batchSize) {
      const last = Math.min(first + batchSize - 1, scanPageCount);
      const partial = Array.from({ length: last - first + 1 }, (_, index) => first + index);
      const batch = await parser.getText({ partial });
      for (const page of batch.pages) extractedPageMap.set(page.num, { page: page.num, text: page.text });
      if (detectChapterStarts([...extractedPageMap.values()]).length >= 3) break;
    }
    const scannedPages = [...extractedPageMap.values()].sort((a, b) => a.page - b.page);
    const selectedPages = selectContentPages(scannedPages);
    const selectedPageNumbers = new Set(selectedPages.map((page) => page.page));
    const knownChapterStarts = configuredChapterStarts?.length ? configuredChapterStarts : detectChapterStarts(scannedPages);
    const evidencePageNumbers = [...new Set(evidencePages)]
      .filter((page) => page >= 1 && page <= pageCount && !selectedPageNumbers.has(page));
    if (evidencePageNumbers.length) {
      const evidenceResult = await parser.getText({ partial: evidencePageNumbers });
      for (const page of evidenceResult.pages) {
        if (!page.text.trim()) continue;
        const chapterIndex = knownChapterStarts.filter((start) => start <= page.num).length;
        selectedPages.push({ page: page.num, text: page.text.trim(), chapter: Math.max(chapterIndex, 1) });
        selectedPageNumbers.add(page.num);
      }
      selectedPages.sort((a, b) => a.page - b.page);
    }
    const processedPageCount = selectedPages.length;
    const passages: Passage[] = [];
    for (const page of selectedPages) {
      chunks(page.text).forEach((text, index) => {
        passages.push({ id: stableId("passage", documentId, page.page, index, text), chapter: page.chapter, page: page.page, text });
      });
    }
    const readableCharacters = passages.reduce((sum, passage) => sum + passage.text.replace(/\s/g, "").length, 0);
    if (readableCharacters < 40) throw new ReadablePdfError("NO_READABLE_TEXT", "We could not find readable text. This PDF may be scanned; OCR is not available in this demo.");
    return {
      passages,
      pageCount,
      processedPageCount,
      firstContentPage: selectedPages[0]?.page ?? 1,
      chapterDetected: knownChapterStarts.length > 0,
      verifiedProfileId: options.profileId || metadataProfile?.id,
    };
  } catch (error) {
    if (error instanceof ReadablePdfError) throw error;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("password") || message.includes("encrypted")) throw new ReadablePdfError("PROTECTED_PDF", "This PDF is encrypted or password-protected and cannot be processed.");
    throw new ReadablePdfError("INVALID_PDF", "The PDF appears to be corrupted or unsupported.");
  } finally {
    await parser.destroy();
  }
}

export function extractGraph(documentId: string, passages: Passage[]): GraphResult {
  const fullText = passages.map((p) => p.text).join(" ");
  const matches = fullText.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) || [];
  const counts = new Map<string, number>();
  for (const name of matches) {
    const words = name.toLowerCase().split(/\s+/);
    if (words.every((word) => !NAME_STOP_WORDS.has(word))) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name);
  if (!names.length) names.push("Main Character");

  const themeDefinitions = [
    { label: "Family Expectations", words: /family|mother|father|parent|daughter|son|expect|duty/i },
    { label: "Identity", words: /identity|belong|self|different|name|home/i },
    { label: "Ambition", words: /ambition|future|success|career|dream|achieve/i },
    { label: "Conflict", words: /argue|conflict|fight|fear|pressure|angry/i },
  ];
  const themes = themeDefinitions.filter((theme) => theme.words.test(fullText)).slice(0, 2);
  if (!themes.length) themes.push({ label: "Central Idea", words: /./ });

  const characterNodes: GraphNode[] = names.map((name) => ({ id: stableId("node", documentId, "character", canonicalize(name)), label: name, type: "character", description: `A person named in the uploaded passage.` }));
  const themeNodes: GraphNode[] = themes.map((theme) => ({ id: stableId("node", documentId, "theme", canonicalize(theme.label)), label: theme.label, type: "theme", description: "A theme supported by words in the uploaded passage." }));
  const edges: GraphEdge[] = [];
  for (const character of characterNodes) {
    const passage = passages.find((p) => p.text.includes(character.label));
    const theme = themes.find((t) => passage && t.words.test(passage.text));
    const themeNode = themeNodes.find((node) => node.label === theme?.label);
    if (passage && themeNode) edges.push({ id: stableId("edge", documentId, character.id, themeNode.id), source: character.id, target: themeNode.id, label: "connects to", passageId: passage.id, confidence: 0.68, inferred: true });
  }
  if (characterNodes.length > 1) {
    const shared = passages.find((p) => p.text.includes(characterNodes[0].label) && p.text.includes(characterNodes[1].label));
    if (shared) edges.push({ id: stableId("edge", documentId, characterNodes[0].id, characterNodes[1].id), source: characterNodes[0].id, target: characterNodes[1].id, label: "appears with", passageId: shared.id, confidence: 0.75, inferred: false });
  }
  return { nodes: [...characterNodes, ...themeNodes], edges, passageIds: [...new Set(edges.flatMap((edge) => edge.passageId ? [edge.passageId] : []))] };
}
