#!/usr/bin/env node

/**
 * CLI tool for viewing ELF Learnings
 * Usage: node scripts/view-learnings.js [success|failure|all]
 */

import { initDatabase, getDbClient } from "../dist/db/client.js";

async function main() {
  const [,, filter = "all"] = process.argv;
  
  await initDatabase();
  
  const db = getDbClient(); // Defaults to global
  
  let query = "SELECT * FROM learnings ORDER BY created_at DESC";
  const args = [];
  
  if (filter !== "all") {
    query = "SELECT * FROM learnings WHERE category = ? ORDER BY created_at DESC";
    args.push(filter);
  }
  
  const result = await db.execute({ sql: query, args });
  
  if (result.rows.length === 0) {
    console.log(`No ${filter} learnings found yet.`);
    return;
  }
  
  console.log(`\n${filter.toUpperCase()} Learnings (Global):`);
  console.log("─".repeat(80));
  
  for (const row of result.rows) {
    const emoji = row.category === 'success' ? '✓' : '✗';
    console.log(`\n${emoji} ${row.category.toUpperCase()}`);
    console.log(`ID: ${row.id}`);
    console.log(`Content: ${row.content}`);
    console.log(`Created: ${new Date(row.created_at).toLocaleString()}`);
    console.log(`Hash: ${row.context_hash}`);
  }
  
  console.log(`\n${"─".repeat(80)}`);
  console.log(`Total: ${result.rows.length} learnings`);
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
