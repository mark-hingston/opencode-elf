import { createClient, type Client } from "@libsql/client";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { GLOBAL_DB_PATH } from "../config.js";

export type DbScope = "global" | "project";

// Track multiple database clients
const dbClients: Map<string, Client> = new Map();

/**
 * Get or create a database client for a specific path
 */
export function getDbClient(dbPath: string = GLOBAL_DB_PATH): Client {
  const existingClient = dbClients.get(dbPath);
  if (existingClient) {
    return existingClient;
  }
  
  // Ensure directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const client = createClient({
    url: `file:${dbPath}`,
  });
  
  dbClients.set(dbPath, client);
  return client;
}

/**
 * Get multiple database clients for hybrid queries
 */
export function getDbClients(paths: { global: string; project: string | null }): Client[] {
  const clients: Client[] = [getDbClient(paths.global)];
  
  if (paths.project) {
    clients.push(getDbClient(paths.project));
  }
  
  return clients;
}

/**
 * Initialize a database with the ELF schema
 */
export async function initDatabase(dbPath?: string): Promise<void> {
  const db = getDbClient(dbPath);
  
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
    "CREATE INDEX IF NOT EXISTS idx_metrics_created_at ON metrics(created_at);",

    // FTS5 Virtual Table for full-text search on learnings
    `CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
      id UNINDEXED,
      content,
      category UNINDEXED,
      tokenize = 'porter unicode61'
    );`,

    // Trigger to sync FTS table on INSERT
    `CREATE TRIGGER IF NOT EXISTS learnings_fts_ai AFTER INSERT ON learnings BEGIN
      INSERT INTO learnings_fts(id, content, category)
      VALUES (new.id, new.content, new.category);
    END;`,

    // Trigger to sync FTS table on DELETE
    `CREATE TRIGGER IF NOT EXISTS learnings_fts_ad AFTER DELETE ON learnings BEGIN
      DELETE FROM learnings_fts WHERE id = old.id;
    END;`,

    // Trigger to sync FTS table on UPDATE
    `CREATE TRIGGER IF NOT EXISTS learnings_fts_au AFTER UPDATE ON learnings BEGIN
      DELETE FROM learnings_fts WHERE id = old.id;
      INSERT INTO learnings_fts(id, content, category)
      VALUES (new.id, new.content, new.category);
    END;`
  ];

  for (const query of queries) {
    await db.execute(query);
  }
}

/**
 * Check if the database is empty (no golden rules or heuristics)
 */
export async function isDatabaseEmpty(dbPath?: string): Promise<boolean> {
  const db = getDbClient(dbPath);
  
  const [rulesResult, heuristicsResult] = await Promise.all([
    db.execute("SELECT COUNT(*) as count FROM golden_rules"),
    db.execute("SELECT COUNT(*) as count FROM heuristics"),
  ]);
  
  const rulesCount = rulesResult.rows[0].count as number;
  const heuristicsCount = heuristicsResult.rows[0].count as number;
  
  return rulesCount === 0 && heuristicsCount === 0;
}

/**
 * Default golden rules to seed on first run
 */
export const DEFAULT_RULES = [
  "Always validate user inputs before processing to prevent security vulnerabilities",
  "Use TypeScript strict mode for better type safety and fewer runtime errors",
  "Write tests for critical functionality to ensure code reliability",
  "Document complex algorithms and business logic for future maintainability",
  "Handle errors gracefully with proper error messages and recovery strategies",
  "Use environment variables for configuration instead of hardcoding values",
  "Follow the principle of least privilege when dealing with permissions",
  "Keep dependencies up to date to avoid security vulnerabilities",
  "Use descriptive variable and function names for better code readability",
  "Avoid premature optimization - make it work first, then optimize if needed"
];

/**
 * Default heuristics to seed on first run
 */
export const DEFAULT_HEURISTICS = [
  {
    pattern: "npm install",
    suggestion: "Ensure package.json exists before running npm install"
  },
  {
    pattern: "npm.*ERR.*ENOENT.*package\\.json",
    suggestion: "Missing package.json - initialize with 'npm init' first"
  },
  {
    pattern: "git commit",
    suggestion: "Check that files are staged with 'git add' before committing"
  },
  {
    pattern: "git push.*rejected",
    suggestion: "Pull latest changes with 'git pull' before pushing"
  },
  {
    pattern: "docker.*not found",
    suggestion: "Ensure Docker daemon is running with 'docker ps'"
  },
  {
    pattern: "permission denied",
    suggestion: "Check file permissions or use sudo if appropriate"
  },
  {
    pattern: "port.*already in use",
    suggestion: "Check for processes using the port with 'lsof -i' or 'netstat'"
  },
  {
    pattern: "cannot find module",
    suggestion: "Install dependencies with 'npm install' or check import paths"
  },
  {
    pattern: "typescript.*error TS",
    suggestion: "Run 'tsc --noEmit' to see all TypeScript errors"
  },
  {
    pattern: "test.*fail",
    suggestion: "Review test output and check for recent code changes"
  }
];

/**
 * Seed default golden rules (uses queryService to generate embeddings)
 */
export async function seedGoldenRules(addGoldenRule: (content: string) => Promise<void>): Promise<void> {
  console.log("ELF: Seeding default golden rules...");
  
  for (const rule of DEFAULT_RULES) {
    await addGoldenRule(rule);
  }
  
  console.log(`ELF: Added ${DEFAULT_RULES.length} default golden rules`);
}

/**
 * Seed default heuristics
 */
export async function seedHeuristics(dbPath?: string): Promise<void> {
  console.log("ELF: Seeding default heuristics...");
  
  const db = getDbClient(dbPath);
  
  for (const heuristic of DEFAULT_HEURISTICS) {
    const id = createHash('sha256')
      .update(heuristic.pattern + heuristic.suggestion)
      .digest('hex')
      .slice(0, 16);
    
    await db.execute({
      sql: `INSERT OR IGNORE INTO heuristics (id, pattern, suggestion, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [id, heuristic.pattern, heuristic.suggestion, Date.now()]
    });
  }
  
  console.log(`ELF: Added ${DEFAULT_HEURISTICS.length} default heuristics`);
}

/**
 * Backfill FTS table with existing learnings
 * This is needed for databases created before FTS support was added
 */
export async function backfillFTS(dbPath?: string): Promise<void> {
  const db = getDbClient(dbPath);
  
  try {
    // Check if there are learnings not in FTS
    const result = await db.execute(`
      SELECT l.id, l.content, l.category 
      FROM learnings l
      LEFT JOIN learnings_fts fts ON l.id = fts.id
      WHERE fts.id IS NULL
    `);
    
    if (result.rows.length === 0) {
      return; // Nothing to backfill
    }
    
    console.log(`ELF: Backfilling ${result.rows.length} learnings to FTS index...`);
    
    for (const row of result.rows) {
      await db.execute({
        sql: "INSERT INTO learnings_fts(id, content, category) VALUES (?, ?, ?)",
        args: [row.id as string, row.content as string, row.category as string]
      });
    }
    
    console.log("ELF: FTS backfill complete");
  } catch (error) {
    // FTS table might not exist yet in very old databases, ignore
    console.error("ELF: FTS backfill skipped (may not be initialized yet)");
  }
}
