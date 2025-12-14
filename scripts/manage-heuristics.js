#!/usr/bin/env node

/**
 * CLI tool for managing ELF Heuristics
 * Usage: node scripts/manage-heuristics.js [add|list|delete]
 */

const { initDatabase, getDbClient } = require("../dist/db/client");
const { createHash } = require("node:crypto");

async function main() {
  const [,, command, ...args] = process.argv;
  
  await initDatabase();
  
  switch (command) {
    case "add": {
      // Expects: "pattern" "suggestion"
      if (args.length < 2) {
        console.error('Usage: node scripts/manage-heuristics.js add "regex-pattern" "suggestion text"');
        process.exit(1);
      }
      // Reconstruct args to handle the split
      const fullArg = args.join(" ");
      // Simple parser: assumes pattern is the first quoted string or word
      const patternMatch = fullArg.match(/^"([^"]+)"\s+(.+)$/) || fullArg.match(/^(\S+)\s+(.+)$/);
      
      if (!patternMatch) {
        console.error("Error: Could not parse pattern and suggestion.");
        process.exit(1);
      }
      await addHeuristic(patternMatch[1], patternMatch[2]);
      break;
    }
    case "list":
      await listHeuristics();
      break;
    case "delete":
      await deleteHeuristic(args[0]);
      break;
    default:
      console.log(`
ELF Heuristics Manager

Usage:
  node scripts/manage-heuristics.js add "pattern" "suggestion"
  node scripts/manage-heuristics.js list
  node scripts/manage-heuristics.js delete <id>

Examples:
  node scripts/manage-heuristics.js add "npm install" "Check package.json exists first"
  node scripts/manage-heuristics.js add "^git commit" "Ensure you have staged files with git add"
      `);
  }
}

async function addHeuristic(pattern, suggestion) {
  const db = getDbClient();
  
  // Validate regex
  try {
    new RegExp(pattern);
  } catch (e) {
    console.error("Error: Invalid Regular Expression pattern");
    process.exit(1);
  }

  const id = createHash('sha256')
    .update(pattern + suggestion)
    .digest('hex')
    .slice(0, 16);

  console.log(`Adding heuristic: /${pattern}/ -> "${suggestion}"`);
  
  await db.execute({
    sql: `INSERT INTO heuristics (id, pattern, suggestion, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [id, pattern, suggestion, Date.now()]
  });
  
  console.log("✓ Heuristic added successfully");
}

async function listHeuristics() {
  const db = getDbClient();
  const result = await db.execute("SELECT * FROM heuristics ORDER BY created_at DESC");
  
  if (result.rows.length === 0) {
    console.log("No heuristics found.");
    return;
  }
  
  console.log("\nHeuristics (Regex Patterns):");
  console.log("─".repeat(80));
  
  for (const row of result.rows) {
    console.log(`\nID: ${row.id}`);
    console.log(`Pattern: /${row.pattern}/`);
    console.log(`Suggestion: ${row.suggestion}`);
  }
  
  console.log(`\n${"─".repeat(80)}`);
}

async function deleteHeuristic(id) {
  if (!id) {
    console.error("Error: ID is required");
    process.exit(1);
  }
  
  const db = getDbClient();
  await db.execute({
    sql: "DELETE FROM heuristics WHERE id = ?",
    args: [id]
  });
  
  console.log("✓ Heuristic deleted successfully");
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
