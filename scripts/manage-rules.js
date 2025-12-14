#!/usr/bin/env node

/**
 * CLI tool for managing ELF Golden Rules
 * Usage: node scripts/manage-rules.js [add|list] [content?]
 */

import { initDatabase, getDbClient } from "../dist/db/client.js";
import { queryService } from "../dist/services/query.js";

async function main() {
  const [,, command, ...args] = process.argv;
  
  await initDatabase();
  
  switch (command) {
    case "add":
      await addRule(args.join(" "));
      break;
    case "list":
      await listRules();
      break;
    case "delete":
      await deleteRule(args[0]);
      break;
    default:
      console.log(`
ELF Golden Rules Manager

Usage:
  node scripts/manage-rules.js add <content>     Add a new golden rule
  node scripts/manage-rules.js list              List all golden rules
  node scripts/manage-rules.js delete <id>       Delete a golden rule

Examples:
  node scripts/manage-rules.js add "Always validate user inputs"
  node scripts/manage-rules.js list
      `);
  }
}

async function addRule(content) {
  if (!content) {
    console.error("Error: Content is required");
    process.exit(1);
  }
  
  console.log("Adding golden rule:", content);
  // Default to global scope for CLI
  await queryService.addGoldenRule(content, "global");
  console.log("✓ Golden rule added successfully");
}

async function listRules() {
  const db = getDbClient(); // Defaults to global
  const result = await db.execute("SELECT * FROM golden_rules ORDER BY hit_count DESC");
  
  if (result.rows.length === 0) {
    console.log("No golden rules found. Add some with: node scripts/manage-rules.js add <content>");
    return;
  }
  
  console.log("\nGolden Rules (Global):");
  console.log("─".repeat(80));
  
  for (const row of result.rows) {
    console.log(`\nID: ${row.id}`);
    console.log(`Content: ${row.content}`);
    console.log(`Hit Count: ${row.hit_count}`);
    console.log(`Created: ${new Date(row.created_at).toLocaleString()}`);
  }
  
  console.log(`\n${"─".repeat(80)}`);
  console.log(`Total: ${result.rows.length} rules`);
}

async function deleteRule(id) {
  if (!id) {
    console.error("Error: Rule ID is required");
    process.exit(1);
  }
  
  const db = getDbClient();
  await db.execute({
    sql: "DELETE FROM golden_rules WHERE id = ?",
    args: [id]
  });
  
  console.log("✓ Golden rule deleted successfully");
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
