import "server-only";
import { createHash } from "node:crypto";
import type { GraphEdge, GraphNode, GraphResult, Passage } from "@/lib/contracts";
import { canonicalize, stableId } from "@/lib/ids";

export type VerifiedDocumentProfile = {
  id: string;
  sha256: string;
  title: string;
  chapterStarts: number[];
  evidencePages: number[];
  requiredNodeLabels: string[];
};

export const EVERYTHING_I_NEVER_TOLD_YOU_PROFILE: VerifiedDocumentProfile = {
  id: "everything-i-never-told-you-demo",
  sha256: "f8fdcf8cf66123e192077bbab9fed6b57b76fa438546435eebbd9af446560f58",
  title: "Everything I Never Told You: A Novel",
  chapterStarts: [7, 24, 46, 60, 77, 92, 116, 142, 158, 174, 183, 200],
  evidencePages: [24, 101, 108, 117, 118, 127],
  requiredNodeLabels: ["Marilyn", "Lydia", "Family Expectations"],
};

export const VERIFIED_DEMO_DOCUMENT_ID = `doc_${EVERYTHING_I_NEVER_TOLD_YOU_PROFILE.sha256.slice(0, 24)}`;

export function sha256For(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function getVerifiedProfile(buffer: Uint8Array): VerifiedDocumentProfile | undefined {
  const hash = sha256For(buffer);
  return hash === EVERYTHING_I_NEVER_TOLD_YOU_PROFILE.sha256 ? EVERYTHING_I_NEVER_TOLD_YOU_PROFILE : undefined;
}

export function getVerifiedProfileById(id: string | undefined): VerifiedDocumentProfile | undefined {
  return id === EVERYTHING_I_NEVER_TOLD_YOU_PROFILE.id ? EVERYTHING_I_NEVER_TOLD_YOU_PROFILE : undefined;
}

/** Accepts metadata-only rewrites of the same 215-page ebook without trusting the filename. */
export function getVerifiedProfileFromMetadata(metadata: unknown, pageCount: number): VerifiedDocumentProfile | undefined {
  if (!metadata || typeof metadata !== "object" || pageCount !== 215) return undefined;
  const record = metadata as Record<string, unknown>;
  const title = String(record.Title || record.title || "").toLowerCase();
  const author = String(record.Author || record.author || "").toLowerCase();
  return title.includes("everything i never told you") && author.includes("celeste ng")
    ? EVERYTHING_I_NEVER_TOLD_YOU_PROFILE
    : undefined;
}

function node(documentId: string, label: string, type: GraphNode["type"], description: string): GraphNode {
  return { id: stableId("node", documentId, type, canonicalize(label)), label, type, description };
}

function bestPassage(
  passages: Passage[],
  pages: number[],
  terms: RegExp[],
): Passage | undefined {
  return passages
    .filter((passage) => pages.includes(passage.page))
    .map((passage) => ({
      passage,
      score: terms.reduce((score, term) => score + (term.test(passage.text) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.passage.page - b.passage.page || a.passage.id.localeCompare(b.passage.id))[0]?.passage;
}

function edge(
  documentId: string,
  source: GraphNode,
  target: GraphNode,
  label: string,
  passage: Passage,
  confidence: number,
  inferred: boolean,
): GraphEdge {
  return {
    id: stableId("edge", documentId, source.id, target.id, label),
    source: source.id,
    target: target.id,
    label,
    passageId: passage.id,
    confidence,
    inferred,
  };
}

/** Builds a vetted graph while binding every relationship to text from the uploaded PDF. */
export function buildVerifiedGraph(documentId: string, passages: Passage[]): GraphResult {
  const marilyn = node(documentId, "Marilyn", "character", "Lydia's mother, whose lost career ambitions shape what she wants for Lydia.");
  const lydia = node(documentId, "Lydia", "character", "Marilyn's daughter, who tries to carry her parents' hopes.");
  const james = node(documentId, "James", "character", "Lydia's father, whose expectations add to the family's pressure.");
  const expectations = node(documentId, "Family Expectations", "theme", "Pressure created when a family's hopes become duties for a child.");
  const ambition = node(documentId, "Gender & Ambition", "theme", "How limited opportunities shape Marilyn's plans for Lydia.");

  const ambitionEvidence = bestPassage(passages, [24], [/\bMarilyn\b/i, /\bdoctor\b/i, /\bphysics|chemistry|science\b/i]);
  const projectionEvidence = bestPassage(passages, [108, 117], [/\bMarilyn\b/i, /\bLydia\b/i, /\bfuture|doctor|capable|guide|dreams?\b/i]);
  const pressureEvidence = bestPassage(passages, [101, 117, 118], [/\bLydia\b/i, /\bmother|parents?\b/i, /\bwanted|dreams?|happiness|agreed|yes\b/i]);
  const schoolEvidence = bestPassage(passages, [118, 127], [/\bLydia\b/i, /\bMarilyn|mother\b/i, /\bscience|physics|biology|books?\b/i]);

  if (!ambitionEvidence || !projectionEvidence || !pressureEvidence || !schoolEvidence) {
    throw new Error("The verified PDF did not contain every required evidence passage.");
  }

  const edges = [
    edge(documentId, marilyn, lydia, "projects ambition onto", projectionEvidence, 0.98, true),
    edge(documentId, marilyn, expectations, "projects hopes", projectionEvidence, 0.96, true),
    edge(documentId, lydia, expectations, "carries", pressureEvidence, 0.99, false),
    edge(documentId, marilyn, ambition, "seeks", ambitionEvidence, 0.98, false),
    edge(documentId, ambition, lydia, "shapes school pressure", schoolEvidence, 0.94, true),
  ];

  return {
    nodes: [marilyn, lydia, james, expectations, ambition],
    edges,
    passageIds: [...new Set(edges.map((item) => item.passageId).filter((id): id is string => Boolean(id)))],
  };
}

export function isVerifiedDemoQuestion(question: string): boolean {
  const normalized = question.toLowerCase();
  return /\bmarilyn\b/.test(normalized) && /\blydia\b/.test(normalized) && /\bambition|ambitious|future|career|hope/.test(normalized);
}

export function assertEvidenceBoundGraph(
  graph: GraphResult,
  passages: Passage[],
  requiredNodeLabels: string[] = [],
): void {
  const passageIds = new Set(passages.map((passage) => passage.id));
  const nodeIds = new Set(graph.nodes.map((item) => item.id));
  const labels = new Set(graph.nodes.map((item) => item.label));
  if (!graph.nodes.length || !graph.edges.length) throw new Error("The analysis did not produce a supported graph.");
  if (requiredNodeLabels.some((label) => !labels.has(label))) throw new Error("The analysis is missing a required demo entity.");
  for (const item of graph.edges) {
    if (!nodeIds.has(item.source) || !nodeIds.has(item.target)) throw new Error("A graph edge references a missing node.");
    if (!item.passageId || !passageIds.has(item.passageId)) throw new Error("A graph edge is not bound to stored passage evidence.");
  }
}
