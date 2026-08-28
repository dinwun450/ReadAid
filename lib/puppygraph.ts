import "server-only";
import neo4j, { type Driver } from "neo4j-driver";
import type { GraphEdge, GraphNode, GraphResult } from "@/lib/contracts";

let driver: Driver | undefined;

function getDriver(): Driver {
  const uri = process.env.PUPPYGRAPH_BOLT_URI;
  if (!uri) throw new Error("PUPPYGRAPH_BOLT_URI is not configured.");
  driver ??= neo4j.driver(uri, neo4j.auth.basic(process.env.PUPPYGRAPH_USERNAME || "", process.env.PUPPYGRAPH_PASSWORD || ""), {
    connectionTimeout: 5000,
    maxConnectionPoolSize: 3,
  });
  return driver;
}

function properties(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && "properties" in value) return (value as { properties: Record<string, unknown> }).properties;
  return {};
}

function nodeType(value: unknown): GraphNode["type"] {
  if (value && typeof value === "object" && "labels" in value) {
    const labels = (value as { labels?: string[] }).labels || [];
    if (labels.some((label) => label.toLowerCase() === "theme")) return "theme";
    if (labels.some((label) => label.toLowerCase() === "event")) return "event";
  }
  return "character";
}

/** Static, bounded, read-only Cypher. The model can choose parameters, never query text. */
export async function getChapterGraphFromPuppyGraph(documentId: string, limit = 20): Promise<GraphResult> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(
      `MATCH (source)-[relationship]->(target)
       WHERE source.document_id = $documentId AND target.document_id = $documentId
       RETURN source, relationship, target LIMIT $limit`,
      { documentId, limit: neo4j.int(Math.min(Math.max(limit, 1), 20)) },
    );
    const nodeMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    for (const record of result.records) {
      const sourceValue = record.get("source") as unknown;
      const targetValue = record.get("target") as unknown;
      const source = properties(sourceValue);
      const target = properties(targetValue);
      const relationship = properties(record.get("relationship"));
      for (const [item, value] of [[source, sourceValue], [target, targetValue]] as const) {
        const id = String(item.node_id || item.id || "");
        if (id) nodeMap.set(id, {
          id,
          label: String(item.canonical_name || item.label || id),
          type: item.type === "theme" || item.type === "event" ? item.type : nodeType(value),
          description: item.description ? String(item.description) : undefined,
        });
      }
      const sourceId = String(source.node_id || source.id || "");
      const targetId = String(target.node_id || target.id || "");
      if (sourceId && targetId) edges.push({
        id: String(relationship.edge_id || relationship.id || `${sourceId}:${targetId}`),
        source: sourceId,
        target: targetId,
        label: String(relationship.label || "connected to"),
        passageId: relationship.passage_id ? String(relationship.passage_id) : undefined,
        confidence: Number(relationship.confidence || 0.7),
        inferred: String(relationship.explicit_or_inferred || "explicit") === "inferred",
      });
    }
    return { nodes: [...nodeMap.values()], edges, passageIds: [...new Set(edges.flatMap((e) => e.passageId ? [e.passageId] : []))] };
  } finally {
    await session.close();
  }
}

export async function checkPuppyGraph(): Promise<void> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    await session.run("MATCH (n) RETURN n LIMIT $limit", { limit: neo4j.int(1) });
  } finally {
    await session.close();
  }
}

export async function closePuppyGraph(): Promise<void> {
  if (driver) await driver.close();
  driver = undefined;
}
