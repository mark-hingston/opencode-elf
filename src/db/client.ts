import { createClient, type Client } from "@libsql/client";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
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

/**
 * Check if the database is empty (no golden rules or heuristics)
 */
export async function isDatabaseEmpty(): Promise<boolean> {
  const db = getDbClient();
  
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
export async function seedHeuristics(): Promise<void> {
  console.log("ELF: Seeding default heuristics...");
  
  const db = getDbClient();
  
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
