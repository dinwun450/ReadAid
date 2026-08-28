import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@clickhouse/client", "neo4j-driver", "pg"],
};

export default nextConfig;
