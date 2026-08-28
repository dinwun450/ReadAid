import { loadEnvConfig } from "@next/env";
import neo4j from "neo4j-driver";

loadEnvConfig(process.cwd());

type Field = { name: string; type: "STRING" | "FLOAT" };

const catalog = "readaid_clickhouse";
const database = process.env.CLICKHOUSE_DATABASE || "default";
const fields = (...names: string[]) => names.map((name) => ({ sourceFieldName: name, targetFieldName: name }));
const attrs = (...names: string[]): Field[] => names.map((name) => ({ name, type: name === "confidence" ? "FLOAT" : "STRING" }));
const source = (table: string, names: string[]) => ({ externalDataSource: { enabled: true, catalog, schema: database, table, mappedField: fields(...names) } });

async function main() {
  const required = ["CLICKHOUSE_URL", "CLICKHOUSE_USERNAME", "CLICKHOUSE_PASSWORD", "PUPPYGRAPH_USERNAME", "PUPPYGRAPH_PASSWORD"];
  if (required.some((name) => !process.env[name])) throw new Error("Required graph environment variable names are missing.");
  const authorization = Buffer.from(`${process.env.PUPPYGRAPH_USERNAME}:${process.env.PUPPYGRAPH_PASSWORD}`).toString("base64");
  const headers = { Authorization: `Basic ${authorization}`, "Content-Type": "application/json" };
  const graphDriver = neo4j.driver(process.env.PUPPYGRAPH_BOLT_URI!, neo4j.auth.basic(process.env.PUPPYGRAPH_USERNAME!, process.env.PUPPYGRAPH_PASSWORD!), { connectionTimeout: 5000 });
  const graphSession = graphDriver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const current = await graphSession.run("CALL db.labels()");
    const hasLabel = current.records.some((record) => Object.values(record.toObject()).some((value) => typeof value === "string" && value.length > 0));
    if (hasLabel) throw new Error("PuppyGraph already has an active schema; it was left unchanged.");
  } finally {
    await graphSession.close();
    await graphDriver.close();
  }

  const clickhouse = new URL(process.env.CLICKHOUSE_URL!);
  const port = clickhouse.port || (clickhouse.protocol === "https:" ? "8443" : "8123");
  const ssl = clickhouse.protocol === "https:" ? "?ssl=true" : "";
  const schema = {
    catalog: [{ name: catalog, type: "clickhouse", jdbc: { username: process.env.CLICKHOUSE_USERNAME, password: process.env.CLICKHOUSE_PASSWORD, jdbcUri: `jdbc:ch://${clickhouse.hostname}:${port}/${database}${ssl}` } }],
    node: [
      { label: "character", dataSourceGroup: source("characters", ["document_id", "node_id", "canonical_name", "description"]), id: [{ name: "node_id", type: "STRING" }], attribute: attrs("document_id", "canonical_name", "description") },
      { label: "theme", dataSourceGroup: source("themes", ["document_id", "node_id", "canonical_name", "description"]), id: [{ name: "node_id", type: "STRING" }], attribute: attrs("document_id", "canonical_name", "description") },
    ],
    edge: [
      { label: "character_relationship", fromNodeLabel: "character", toNodeLabel: "character", dataSourceGroup: source("character_relationships", ["document_id", "edge_id", "source_node_id", "target_node_id", "label", "passage_id", "confidence", "explicit_or_inferred"]), id: [{ name: "edge_id", type: "STRING" }], fromKey: [{ name: "source_node_id", type: "STRING" }], toKey: [{ name: "target_node_id", type: "STRING" }], attribute: attrs("document_id", "label", "passage_id", "confidence", "explicit_or_inferred") },
      { label: "character_theme", fromNodeLabel: "character", toNodeLabel: "theme", dataSourceGroup: source("character_themes", ["document_id", "edge_id", "character_node_id", "theme_node_id", "label", "passage_id", "confidence", "explicit_or_inferred"]), id: [{ name: "edge_id", type: "STRING" }], fromKey: [{ name: "character_node_id", type: "STRING" }], toKey: [{ name: "theme_node_id", type: "STRING" }], attribute: attrs("document_id", "label", "passage_id", "confidence", "explicit_or_inferred") },
    ],
    localTable: [],
  };
  const response = await fetch("http://localhost:8081/schema?postUploadBehavior=none", { method: "POST", headers, body: JSON.stringify(schema) });
  if (!response.ok) throw new Error(`PuppyGraph rejected the ReadAid schema (HTTP ${response.status}).`);
  console.log("PuppyGraph: configured the previously empty schema with 2 node labels and 2 bounded relationship labels.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "PuppyGraph configuration failed.");
  process.exitCode = 1;
});
