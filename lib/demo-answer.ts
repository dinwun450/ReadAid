import type { AnswerResult, GraphEdge, GraphNode, GraphResult, Passage } from "@/lib/contracts";

const REQUIRED_LABELS = new Set(["Marilyn", "Lydia", "Family Expectations"]);

function bestEdge(graph: GraphResult, source: GraphNode, target: GraphNode, preferred: RegExp): GraphEdge | undefined {
  return graph.edges
    .filter((item) => (item.source === source.id && item.target === target.id) || (item.source === target.id && item.target === source.id))
    .sort((a, b) => {
      const preferredDifference = Number(preferred.test(b.label)) - Number(preferred.test(a.label));
      return preferredDifference || (b.confidence ?? 0) - (a.confidence ?? 0) || a.id.localeCompare(b.id);
    })[0];
}

/** Selects exactly the three required demo relationships, ignoring stale or unrelated graph rows. */
export function selectMarilynLydiaGraph(graph: GraphResult): GraphResult | undefined {
  const marilyn = graph.nodes.find((item) => item.label === "Marilyn");
  const lydia = graph.nodes.find((item) => item.label === "Lydia");
  const expectations = graph.nodes.find((item) => item.label === "Family Expectations");
  if (!marilyn || !lydia || !expectations) return undefined;
  const edges = [
    bestEdge(graph, marilyn, lydia, /project|pressure/i),
    bestEdge(graph, marilyn, expectations, /project|hope|expect/i),
    bestEdge(graph, lydia, expectations, /carr|absorb|pressure|expect/i),
  ];
  if (edges.some((item) => !item?.passageId)) return undefined;
  const supportedEdges = edges.filter((item): item is GraphEdge => Boolean(item));
  return {
    nodes: [marilyn, lydia, expectations],
    edges: supportedEdges,
    passageIds: [...new Set(supportedEdges.flatMap((item) => item.passageId ? [item.passageId] : []))],
  };
}

/** Produces the same synchronized answer contract for prepared and verified uploaded evidence. */
export function buildMarilynLydiaAnswer(
  graph: GraphResult,
  passages: Passage[],
  level: "quick" | "simple" | "detailed" = "simple",
): AnswerResult {
  const focusedGraph = selectMarilynLydiaGraph(graph);
  if (!focusedGraph) throw new Error("The Marilyn and Lydia answer is missing required graph relationships.");
  const { nodes, edges } = focusedGraph;
  const passageIds = focusedGraph.passageIds.slice(0, 3);
  const evidence = passageIds.flatMap((id) => {
    const passage = passages.find((item) => item.id === id);
    return passage ? [passage] : [];
  });

  if (nodes.length !== REQUIRED_LABELS.size || edges.length < 3 || evidence.length !== passageIds.length) {
    throw new Error("The Marilyn and Lydia answer is missing required graph evidence.");
  }

  const explanations = {
    quick: "The passage shows Marilyn placing her hopes on Lydia, which makes Lydia feel responsible for her mother's happiness. The graph links both characters to Family Expectations.",
    simple: "The passages show that Marilyn turns her own lost ambition into plans for Lydia's future, especially in science and medicine. Lydia feels responsible for fulfilling those plans, even when they do not match what she wants. The graph supports this by linking Marilyn to Lydia through projected ambition and connecting both of them to Family Expectations.",
    detailed: "The passages show two sides of the same pressure. Marilyn imagines Lydia achieving the scientific and medical future that Marilyn could not complete. Lydia responds by treating her mother's hopes as a duty: she agrees to difficult science plans and hides her own reluctance because she wants to protect her mother's happiness. The graph supports this reading with three focused links: Marilyn projects ambition onto Lydia, Marilyn's hopes create Family Expectations, and Lydia carries those expectations. The projected-ambition links are dashed because they interpret the passages, while Lydia carrying the pressure is supported more directly by the text.",
  };

  return {
    explanation: explanations[level],
    detailedExplanation: explanations.detailed,
    evidenceLabel: edges.some((item) => item.inferred) ? "Inferred Interpretation" : "Passage Evidence",
    graph: { nodes, edges, passageIds },
    passages: evidence,
  };
}
