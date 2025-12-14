#!/usr/bin/env node

/**
 * Seed the database with default heuristics
 */

import { initDatabase, getDbClient } from "../dist/db/client.js";
import { createHash } from "node:crypto";

const DEFAULT_HEURISTICS = [
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

async function main() {
  console.log("ELF: Seeding database with default heuristics...\n");
  
  await initDatabase();
  const db = getDbClient();
  
  for (const heuristic of DEFAULT_HEURISTICS) {
    const id = createHash('sha256')
      .update(heuristic.pattern + heuristic.suggestion)
      .digest('hex')
      .slice(0, 16);
    
    console.log(`Adding: /${heuristic.pattern}/`);
    console.log(`  → ${heuristic.suggestion}`);
    
    await db.execute({
      sql: `INSERT OR IGNORE INTO heuristics (id, pattern, suggestion, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [id, heuristic.pattern, heuristic.suggestion, Date.now()]
    });
  }
  
  console.log(`\n✓ Successfully processed ${DEFAULT_HEURISTICS.length} heuristics`);
  console.log("\nRun 'npm run heuristics:list' to view them");
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
