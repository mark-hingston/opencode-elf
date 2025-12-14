#!/usr/bin/env node

/**
 * Seed the database with default golden rules
 */

const { initDatabase } = require("../dist/db/client");
const { queryService } = require("../dist/services/query");

const DEFAULT_RULES = [
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

async function main() {
  console.log("ELF: Seeding database with default golden rules...\n");
  
  await initDatabase();
  
  for (const rule of DEFAULT_RULES) {
    console.log(`Adding: ${rule}`);
    await queryService.addGoldenRule(rule);
  }
  
  console.log(`\n✓ Successfully added ${DEFAULT_RULES.length} golden rules`);
  console.log("\nRun 'npm run rules:list' to view them");
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
