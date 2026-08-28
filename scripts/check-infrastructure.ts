import { loadEnvConfig } from "@next/env";
import { createClient } from "@clickhouse/client";
import neo4j from "neo4j-driver";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

const required = ["DATABASE_URL", "CLICKHOUSE_URL", "CLICKHOUSE_USERNAME", "CLICKHOUSE_PASSWORD", "PUPPYGRAPH_BOLT_URI", "PUPPYGRAPH_USERNAME", "PUPPYGRAPH_PASSWORD"];

async function main() {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variable names: ${missing.join(", ")}`);
  console.log(`Environment names: ${required.length} required names are present.`);
  const postgres = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const clickhouse = createClient({ url: process.env.CLICKHOUSE_URL!, username: process.env.CLICKHOUSE_USERNAME!, password: process.env.CLICKHOUSE_PASSWORD!, database: process.env.CLICKHOUSE_DATABASE || "default" });
  const puppygraph = neo4j.driver(process.env.PUPPYGRAPH_BOLT_URI!, neo4j.auth.basic(process.env.PUPPYGRAPH_USERNAME!, process.env.PUPPYGRAPH_PASSWORD!), { connectionTimeout: 5000 });
  const puppySession = puppygraph.session({ defaultAccessMode: neo4j.session.READ });
  try {
    await postgres.query("SELECT 1");
    console.log("PostgreSQL: SELECT 1 succeeded.");
    const result = await clickhouse.query({ query: "SELECT 1 AS ok", format: "JSONEachRow" });
    await result.json();
    console.log("ClickHouse Cloud: SELECT 1 succeeded.");
    await puppySession.run("MATCH (n) RETURN n LIMIT $limit", { limit: neo4j.int(1) });
    console.log("PuppyGraph: bounded read-only query succeeded.");
  } finally {
    await Promise.allSettled([postgres.end(), clickhouse.close(), puppySession.close(), puppygraph.close()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Infrastructure check failed.");
  process.exitCode = 1;
});
