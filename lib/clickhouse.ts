import "server-only";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { GraphEdge, GraphNode, GraphResult, Passage } from "@/lib/contracts";

let client: ClickHouseClient | undefined;
let initialized: Promise<void> | undefined;

function getClient(): ClickHouseClient {
  if (!process.env.CLICKHOUSE_URL) throw new Error("CLICKHOUSE_URL is not configured.");
  client ??= createClient({
    url: process.env.CLICKHOUSE_URL,
    username: process.env.CLICKHOUSE_USERNAME || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
    database: process.env.CLICKHOUSE_DATABASE || "default",
  });
  return client;
}

export async function ensureClickHouseSchema(): Promise<void> {
  initialized ??= (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS passages (document_id String, chapter_number UInt16, page_number UInt16, passage_id String, position UInt16, text String, text_hash String, updated_at DateTime64(3) DEFAULT now64()) ENGINE=ReplacingMergeTree(updated_at) ORDER BY (document_id, passage_id)`,
      `CREATE TABLE IF NOT EXISTS characters (document_id String, node_id String, canonical_name String, description String, passage_ids Array(String), confidence Float32, updated_at DateTime64(3) DEFAULT now64()) ENGINE=ReplacingMergeTree(updated_at) ORDER BY (document_id, node_id)`,
      `CREATE TABLE IF NOT EXISTS themes (document_id String, node_id String, canonical_name String, description String, passage_ids Array(String), confidence Float32, updated_at DateTime64(3) DEFAULT now64()) ENGINE=ReplacingMergeTree(updated_at) ORDER BY (document_id, node_id)`,
      `CREATE TABLE IF NOT EXISTS character_relationships (document_id String, edge_id String, source_node_id String, target_node_id String, label String, passage_id String, confidence Float32, explicit_or_inferred Enum8('explicit'=1,'inferred'=2), updated_at DateTime64(3) DEFAULT now64()) ENGINE=ReplacingMergeTree(updated_at) ORDER BY (document_id, edge_id)`,
      `CREATE TABLE IF NOT EXISTS character_themes (document_id String, edge_id String, character_node_id String, theme_node_id String, label String, passage_id String, confidence Float32, explicit_or_inferred Enum8('explicit'=1,'inferred'=2), updated_at DateTime64(3) DEFAULT now64()) ENGINE=ReplacingMergeTree(updated_at) ORDER BY (document_id, edge_id)`,
      `CREATE TABLE IF NOT EXISTS interaction_events (document_id String, event_id UUID DEFAULT generateUUIDv4(), event_type LowCardinality(String), metadata_json String, created_at DateTime64(3) DEFAULT now64()) ENGINE=MergeTree ORDER BY (document_id, created_at)`,
    ];
    for (const query of statements) await getClient().command({ query });
  })();
  return initialized;
}

export async function insertPassages(documentId: string, passages: Passage[]): Promise<void> {
  await ensureClickHouseSchema();
  if (!passages.length) return;
  await getClient().insert({
    table: "passages",
    values: passages.map((p, position) => ({
      document_id: documentId, chapter_number: p.chapter, page_number: p.page,
      passage_id: p.id, position, text: p.text, text_hash: p.id.split(":").at(-1) || p.id,
    })),
    format: "JSONEachRow",
  });
}

export async function insertGraph(documentId: string, graph: GraphResult): Promise<void> {
  await ensureClickHouseSchema();
  const characters = graph.nodes.filter((n) => n.type === "character");
  const themes = graph.nodes.filter((n) => n.type === "theme");
  const passageIdsFor = (id: string) => graph.edges.filter((e) => e.source === id || e.target === id).flatMap((e) => e.passageId ? [e.passageId] : []);
  if (characters.length) await getClient().insert({ table: "characters", format: "JSONEachRow", values: characters.map((n) => ({ document_id: documentId, node_id: n.id, canonical_name: n.label, description: n.description || "", passage_ids: passageIdsFor(n.id), confidence: 0.8 })) });
  if (themes.length) await getClient().insert({ table: "themes", format: "JSONEachRow", values: themes.map((n) => ({ document_id: documentId, node_id: n.id, canonical_name: n.label, description: n.description || "", passage_ids: passageIdsFor(n.id), confidence: 0.75 })) });
  const characterIds = new Set(characters.map((n) => n.id));
  const relationships = graph.edges.filter((e) => characterIds.has(e.source) && characterIds.has(e.target));
  const connections = graph.edges.filter((e) => characterIds.has(e.source) !== characterIds.has(e.target));
  if (relationships.length) await getClient().insert({ table: "character_relationships", format: "JSONEachRow", values: relationships.map((e) => ({ document_id: documentId, edge_id: e.id, source_node_id: e.source, target_node_id: e.target, label: e.label, passage_id: e.passageId || "", confidence: e.confidence ?? 0.7, explicit_or_inferred: e.inferred ? "inferred" : "explicit" })) });
  if (connections.length) await getClient().insert({ table: "character_themes", format: "JSONEachRow", values: connections.map((e) => ({ document_id: documentId, edge_id: e.id, character_node_id: characterIds.has(e.source) ? e.source : e.target, theme_node_id: characterIds.has(e.source) ? e.target : e.source, label: e.label, passage_id: e.passageId || "", confidence: e.confidence ?? 0.7, explicit_or_inferred: e.inferred ? "inferred" : "explicit" })) });
}

/** Removes only one document's derived content so a re-upload cannot retain stale nodes or edges. */
export async function clearDocumentContent(documentId: string): Promise<void> {
  await ensureClickHouseSchema();
  const tables = ["passages", "characters", "themes", "character_relationships", "character_themes"] as const;
  for (const table of tables) {
    const queryParams = { documentId };
    try {
      await getClient().command({
        query: `DELETE FROM ${table} WHERE document_id={documentId:String} SETTINGS lightweight_deletes_sync=2`,
        query_params: queryParams,
      });
    } catch {
      await getClient().command({
        query: `ALTER TABLE ${table} DELETE WHERE document_id={documentId:String} SETTINGS mutations_sync=2`,
        query_params: queryParams,
      });
    }
  }
}

export async function readPassages(documentId: string, passageIds?: string[], limit = 30): Promise<Passage[]> {
  await ensureClickHouseSchema();
  const filter = passageIds?.length ? "AND passage_id IN ({passageIds:Array(String)})" : "";
  const result = await getClient().query({
    query: `SELECT passage_id, chapter_number, page_number, text FROM passages FINAL WHERE document_id={documentId:String} ${filter} ORDER BY chapter_number, page_number, position LIMIT {limit:UInt16}`,
    query_params: { documentId, passageIds: passageIds || [], limit: Math.min(limit, 50) }, format: "JSONEachRow",
  });
  const rows = await result.json<{ passage_id: string; chapter_number: number; page_number: number; text: string }>();
  return rows.map((r) => ({ id: r.passage_id, chapter: r.chapter_number, page: r.page_number, text: r.text }));
}

export async function readGraph(documentId: string, limit = 25): Promise<GraphResult> {
  await ensureClickHouseSchema();
  const params = { documentId, limit: Math.min(limit, 25) };
  const [charactersResult, themesResult, relationshipsResult, connectionsResult] = await Promise.all([
    getClient().query({ query: `SELECT node_id, canonical_name, description FROM characters FINAL WHERE document_id={documentId:String} LIMIT {limit:UInt16}`, query_params: params, format: "JSONEachRow" }),
    getClient().query({ query: `SELECT node_id, canonical_name, description FROM themes FINAL WHERE document_id={documentId:String} LIMIT {limit:UInt16}`, query_params: params, format: "JSONEachRow" }),
    getClient().query({ query: `SELECT edge_id, source_node_id, target_node_id, label, passage_id, confidence, explicit_or_inferred FROM character_relationships FINAL WHERE document_id={documentId:String} LIMIT {limit:UInt16}`, query_params: params, format: "JSONEachRow" }),
    getClient().query({ query: `SELECT edge_id, character_node_id, theme_node_id, label, passage_id, confidence, explicit_or_inferred FROM character_themes FINAL WHERE document_id={documentId:String} LIMIT {limit:UInt16}`, query_params: params, format: "JSONEachRow" }),
  ]);
  const nodeRows = [
    ...(await charactersResult.json<{node_id:string;canonical_name:string;description:string}>()).map((r) => ({ ...r, type: "character" as const })),
    ...(await themesResult.json<{node_id:string;canonical_name:string;description:string}>()).map((r) => ({ ...r, type: "theme" as const })),
  ];
  const relationshipRows = await relationshipsResult.json<{edge_id:string;source_node_id:string;target_node_id:string;label:string;passage_id:string;confidence:number;explicit_or_inferred:string}>();
  const connectionRows = await connectionsResult.json<{edge_id:string;character_node_id:string;theme_node_id:string;label:string;passage_id:string;confidence:number;explicit_or_inferred:string}>();
  const nodes: GraphNode[] = nodeRows.map((r) => ({ id: r.node_id, label: r.canonical_name, type: r.type, description: r.description }));
  const edges: GraphEdge[] = [
    ...relationshipRows.map((r) => ({ id: r.edge_id, source: r.source_node_id, target: r.target_node_id, label: r.label, passageId: r.passage_id, confidence: r.confidence, inferred: r.explicit_or_inferred === "inferred" })),
    ...connectionRows.map((r) => ({ id: r.edge_id, source: r.character_node_id, target: r.theme_node_id, label: r.label, passageId: r.passage_id, confidence: r.confidence, inferred: r.explicit_or_inferred === "inferred" })),
  ];
  return { nodes, edges, passageIds: [...new Set(edges.flatMap((e) => e.passageId ? [e.passageId] : []))] };
}

export async function logInteraction(documentId: string, eventType: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await ensureClickHouseSchema();
    await getClient().insert({ table: "interaction_events", format: "JSONEachRow", values: [{ document_id: documentId, event_type: eventType.slice(0, 80), metadata_json: JSON.stringify(metadata).slice(0, 2000) }] });
  } catch { /* Analytics must never break reading. */ }
}

export async function checkClickHouse(): Promise<void> {
  const result = await getClient().query({ query: "SELECT 1 AS ok", format: "JSONEachRow" });
  await result.json();
}

export async function closeClickHouse(): Promise<void> {
  if (client) await client.close();
  client = undefined;
  initialized = undefined;
}
