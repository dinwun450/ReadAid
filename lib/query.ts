import "server-only";
import type { AnswerResult, GraphResult } from "@/lib/contracts";
import { readGraph, readPassages } from "@/lib/clickhouse";
import { getChapterGraphFromPuppyGraph } from "@/lib/puppygraph";
import { PREPARED_DOCUMENT_ID, preparedAnswer } from "@/lib/prepared";
import { buildMarilynLydiaAnswer, selectMarilynLydiaGraph } from "@/lib/demo-answer";
import { isVerifiedDemoQuestion } from "@/lib/verified-profile";

const words = (value: string) => new Set(value.toLowerCase().match(/[a-z]{3,}/g) || []);
const PRONOUN_LABELS = new Set(["she", "he", "her", "him", "they", "them", "we", "you", "it"]);

function withoutPronounNodes(graph: GraphResult): GraphResult {
  const nodes = graph.nodes.filter((node) => !PRONOUN_LABELS.has(node.label.toLowerCase()));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return { nodes, edges, passageIds: [...new Set(edges.flatMap((edge) => edge.passageId ? [edge.passageId] : []))] };
}

function relationPhrase(source: string, label: string, target: string): string {
  if (label === "appears with") return `${source} appears in the passage with ${target}`;
  if (label === "connects to") return `${source} connects to ${target}`;
  if (label === "projects ambitions") return `${source} projects ambition onto ${target}`;
  if (label === "projects ambition onto") return `${source} projects her ambition onto ${target}`;
  if (label === "projects hopes") return `${source}'s hopes contribute to ${target}`;
  if (label === "carries") return `${source} carries the weight of ${target}`;
  if (label === "shapes school pressure") return `${target} contributes to the school pressure ${source} feels`;
  return `${source} ${label} ${target}`;
}

function asksAboutMarilynOrLydia(question: string): boolean {
  return isVerifiedDemoQuestion(question) || /\b(?:marilyn|lydia)\b/i.test(question);
}

export async function answerQuestion(documentId: string, question: string, level: "quick" | "simple" | "detailed"): Promise<AnswerResult> {
  if (documentId === PREPARED_DOCUMENT_ID) return preparedAnswer(level);
  const prefersDemoEvidence = asksAboutMarilynOrLydia(question);
  let graph: GraphResult;
  if (prefersDemoEvidence) {
    try {
      graph = await readGraph(documentId, 20);
      if (!graph.nodes.length) throw new Error("No ClickHouse graph rows were found.");
    } catch {
      graph = await getChapterGraphFromPuppyGraph(documentId, 20);
    }
  } else {
    try {
      graph = await getChapterGraphFromPuppyGraph(documentId, 20);
      if (!graph.nodes.length) graph = await readGraph(documentId, 20);
    } catch {
      graph = await readGraph(documentId, 20);
    }
  }
  graph = withoutPronounNodes(graph);
  const focusedGraph = selectMarilynLydiaGraph(graph);
  if (prefersDemoEvidence && focusedGraph) {
    const verifiedPassages = await readPassages(documentId, focusedGraph.passageIds, 10);
    return buildMarilynLydiaAnswer(graph, verifiedPassages, level);
  }
  const questionWords = words(question);
  const namedNodes = graph.nodes.filter((node) => {
    const labelWords = words(node.label);
    return [...labelWords].some((word) => questionWords.has(word));
  });
  const activeNodeIds = new Set(namedNodes.map((node) => node.id));
  let edges = graph.edges.filter((edge) => activeNodeIds.has(edge.source) || activeNodeIds.has(edge.target)).slice(0, 5);
  if (!edges.length) edges = graph.edges.slice(0, 3);
  for (const edge of edges) { activeNodeIds.add(edge.source); activeNodeIds.add(edge.target); }
  const nodes = graph.nodes.filter((node) => activeNodeIds.has(node.id)).slice(0, 5);
  const passageIds = [...new Set(edges.flatMap((edge) => edge.passageId ? [edge.passageId] : []))].slice(0, 3);
  const passages = passageIds.length ? await readPassages(documentId, passageIds, 3) : [];
  if (!passages.length || !edges.length) {
    return {
      explanation: "I could not find enough passage evidence to answer that safely. Try naming a character or asking about a connection shown in the graph.",
      detailedExplanation: "No supported relationship and passage pair was returned, so ReadAid did not invent an answer.",
      evidenceLabel: "Passage Evidence",
      graph: { nodes: [], edges: [], passageIds: [] },
      passages: [],
    };
  }
  const labels = nodes.map((node) => node.label).join(", ");
  const relationText = edges.map((edge) => {
    const source = graph.nodes.find((node) => node.id === edge.source)?.label || "One idea";
    const target = graph.nodes.find((node) => node.id === edge.target)?.label || "another idea";
    return relationPhrase(source, edge.label, target);
  }).join(". ");
  const pageText = [...new Set(passages.map((passage) => passage.page))].join(", ");
  const explanations = {
    quick: `The supporting passage connects ${labels}.`,
    simple: `The supporting passage shows these relationships: ${relationText}. The graph supports that reading by highlighting ${labels} and linking the relationships to page${pageText.includes(",") ? "s" : ""} ${pageText}.`,
    detailed: `The passages on page${pageText.includes(",") ? "s" : ""} ${pageText} support this reading: ${relationText}. The graph makes that evidence visible by highlighting ${labels} and the edges between them. Dashed edges mark interpretation; solid edges mark relationships stated more directly in the text.`,
  };
  return {
    explanation: explanations[level],
    detailedExplanation: explanations.detailed,
    evidenceLabel: edges.some((edge) => edge.inferred) ? "Inferred Interpretation" : "Passage Evidence",
    graph: { nodes, edges, passageIds },
    passages,
  };
}
