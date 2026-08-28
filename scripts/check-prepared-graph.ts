import { loadEnvConfig } from "@next/env";
import neo4j from "neo4j-driver";

loadEnvConfig(process.cwd());

async function main() {
  const driver = neo4j.driver(process.env.PUPPYGRAPH_BOLT_URI!, neo4j.auth.basic(process.env.PUPPYGRAPH_USERNAME!, process.env.PUPPYGRAPH_PASSWORD!), { connectionTimeout: 5000 });
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(
      `MATCH (source)-[relationship]->(target)
       WHERE source.document_id = $documentId AND target.document_id = $documentId
       RETURN source, relationship, target LIMIT $limit`,
      { documentId: "doc_prepared_everything_i_never_told_you", limit: neo4j.int(10) },
    );
    if (!result.records.length) {
      const metadata = await session.run("MATCH (source)-[relationship]->(target) RETURN labels(source) AS source_labels, keys(source) AS source_keys, type(relationship) AS relationship_type, keys(relationship) AS relationship_keys, labels(target) AS target_labels, keys(target) AS target_keys LIMIT $limit", { limit: neo4j.int(5) });
      const summary = metadata.records.map((record) => ({
        sourceLabels: record.get("source_labels"), sourceKeys: record.get("source_keys"),
        relationshipType: record.get("relationship_type"), relationshipKeys: record.get("relationship_keys"),
        targetLabels: record.get("target_labels"), targetKeys: record.get("target_keys"),
      }));
      const labels = await session.run("CALL db.labels()");
      const types = await session.run("CALL db.relationshipTypes()");
      const schemaSummary = { nodeLabels: labels.records.map((record) => record.toObject()), relationshipTypes: types.records.map((record) => record.toObject()) };
      throw new Error(`PuppyGraph returned no prepared relationship path. Query metadata: ${JSON.stringify(summary)}. Active labels: ${JSON.stringify(schemaSummary)}`);
    }
    console.log(`PuppyGraph prepared path: ${result.records.length} bounded relationship record(s) returned.`);
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Prepared graph check failed.");
  process.exitCode = 1;
});
