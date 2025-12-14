import { createClient, type Client } from "@libsql/client";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "../config";

let dbClient: Client | null = null;

export function getDbClient(): Client {
  if (!dbClient) {
    // Ensure directory exists
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    dbClient = createClient({
      url: `file:${DB_PATH}`,
    });
  }
  return dbClient;
}

export async function initDatabase(): Promise<void> {
  const db = getDbClient();
  
  const queries = [
    `CREATE TABLE IF NOT EXISTS golden_rules (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      hit_count INTEGER DEFAULT 0
    );`,
    
    `CREATE TABLE IF NOT EXISTS learnings (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT CHECK(category IN ('success', 'failure')) NOT NULL,
      embedding TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      context_hash TEXT
    );`,
    
    "CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);",
    "CREATE INDEX IF NOT EXISTS idx_learnings_context_hash ON learnings(context_hash);",

    `CREATE TABLE IF NOT EXISTS heuristics (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      suggestion TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      meta TEXT,
      created_at INTEGER NOT NULL
    );`,
    
    "CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(type);",
    "CREATE INDEX IF NOT EXISTS idx_metrics_created_at ON metrics(created_at);"
  ];

  for (const query of queries) {
    await db.execute(query);
  }
}
