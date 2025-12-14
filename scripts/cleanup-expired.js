#!/usr/bin/env node

/**
 * CLI tool for cleaning up expired ELF data
 * Usage: node scripts/cleanup-expired.js [preview|clean]
 */

import { initDatabase, getDbClient } from "../dist/db/client.js";
import { cleanupExpiredData, getCleanupPreview } from "../dist/services/cleanup.js";
import { 
  RULE_EXPIRATION_DAYS, 
  LEARNING_EXPIRATION_DAYS, 
  HEURISTIC_EXPIRATION_DAYS,
  RULE_MIN_HITS_TO_KEEP 
} from "../dist/config.js";

async function main() {
  const [,, command] = process.argv;
  
  await initDatabase();
  const db = getDbClient();
  
  switch (command) {
    case "preview":
      await previewCleanup(db);
      break;
    case "clean":
      await performCleanup(db);
      break;
    default:
      console.log(`
ELF Cleanup Tool

Usage:
  node scripts/cleanup-expired.js preview    Show what would be deleted
  node scripts/cleanup-expired.js clean      Delete expired data

Configuration:
  - Rules: Delete if ${RULE_MIN_HITS_TO_KEEP} or fewer hits and older than ${RULE_EXPIRATION_DAYS} days
  - Learnings: Delete if older than ${LEARNING_EXPIRATION_DAYS} days
  - Heuristics: Delete if older than ${HEURISTIC_EXPIRATION_DAYS} days

Examples:
  node scripts/cleanup-expired.js preview
  node scripts/cleanup-expired.js clean
      `);
  }
}

async function previewCleanup(db) {
  console.log("Analyzing database for expired data...\n");
  
  const stats = await getCleanupPreview(db);
  
  console.log("Preview of data to be deleted:");
  console.log("─".repeat(60));
  console.log(`Golden Rules:  ${stats.rulesDeleted} (unused and older than ${RULE_EXPIRATION_DAYS} days)`);
  console.log(`Learnings:     ${stats.learningsDeleted} (older than ${LEARNING_EXPIRATION_DAYS} days)`);
  console.log(`Heuristics:    ${stats.heuristicsDeleted} (older than ${HEURISTIC_EXPIRATION_DAYS} days)`);
  console.log("─".repeat(60));
  console.log(`Total:         ${stats.rulesDeleted + stats.learningsDeleted + stats.heuristicsDeleted} items`);
  
  if (stats.rulesDeleted + stats.learningsDeleted + stats.heuristicsDeleted === 0) {
    console.log("\nNo expired data found.");
  } else {
    console.log("\nRun with 'clean' to delete this data.");
  }
}

async function performCleanup(db) {
  console.log("Cleaning up expired data...\n");
  
  const stats = await cleanupExpiredData(db);
  
  console.log("Cleanup completed:");
  console.log("─".repeat(60));
  console.log(`Golden Rules deleted:  ${stats.rulesDeleted}`);
  console.log(`Learnings deleted:     ${stats.learningsDeleted}`);
  console.log(`Heuristics deleted:    ${stats.heuristicsDeleted}`);
  console.log("─".repeat(60));
  console.log(`Total deleted:         ${stats.rulesDeleted + stats.learningsDeleted + stats.heuristicsDeleted} items`);
  
  if (stats.rulesDeleted + stats.learningsDeleted + stats.heuristicsDeleted === 0) {
    console.log("\nNo expired data found.");
  } else {
    console.log("\n✓ Cleanup successful");
  }
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
