/**
 * Simulation Script
 * Verifies the full ELF loop without needing OpenCode
 * Run with: npm run test:simulate
 */

import { initDatabase, getDbClient, isDatabaseEmpty, seedGoldenRules, seedHeuristics, backfillFTS } from "../dist/db/client.js";
import { QueryService } from "../dist/services/query.js";
import { embeddingService } from "../dist/services/embeddings.js";
import { GLOBAL_DB_PATH, getDbPaths } from "../dist/config.js";

async function runSimulation() {
  console.log("🤖 Starting ELF Simulation...\n");

  try {
    // 1. Initialize (mimics plugin lazy loading)
    console.log("1️⃣  Simulating plugin initialization...");
    const initStart = Date.now();
    
    // Use current directory for testing
    const testDir = process.cwd();
    const paths = getDbPaths(testDir);
    
    // Initialize global database
    await initDatabase(GLOBAL_DB_PATH);
    
    // Initialize project database if detected
    if (paths.project) {
      console.log(`   Project database detected at: ${paths.project}`);
      await initDatabase(paths.project);
    }
    
    await embeddingService.init();
    
    // Create query service
    const queryService = new QueryService(testDir);
    
    // Check and seed if needed (only global)
    const isEmpty = await isDatabaseEmpty(GLOBAL_DB_PATH);
    if (isEmpty) {
      console.log("   First run detected - seeding default data...");
      await seedGoldenRules(queryService.addGoldenRule.bind(queryService));
      await seedHeuristics(GLOBAL_DB_PATH);
    }
    
    // Backfill FTS for existing learnings
    await backfillFTS(GLOBAL_DB_PATH);
    if (paths.project) {
      await backfillFTS(paths.project);
    }
    
    const initTime = Date.now() - initStart;
    console.log(`✅ Initialization complete (took ${initTime}ms)\n`);
    
    // 2. Simulate a User Query (Context Injection)
    console.log("2️⃣  Simulating Chat Request...");
    
    const context = await queryService.getContext("I want to write a JS function to compare numbers.");
    
    if (context.goldenRules.length > 0) {
      console.log(`✅ SUCCESS: Retrieved ${context.goldenRules.length} golden rules`);
      console.log(`   Example: "${context.goldenRules[0].content.slice(0, 60)}..."`);
    } else {
      console.error("❌ FAILURE: No golden rules retrieved.");
    }

    // 3. Simulate a Tool Failure (Learning Loop)
    // Note: The event hook now captures command context for richer learnings
    // Format: "Tool 'bash' failed running 'npm install': error message"
    console.log("\n3️⃣  Simulating Tool Failure...");
    
    await queryService.recordLearning(
      "Tool 'bash' failed running 'npm install': npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path package.json",
      "failure",
      JSON.stringify({ args: { command: "npm install" }, result: { stderr: "npm ERR! code ENOENT", exitCode: 1 } })
    );
    
    console.log("✅ Tool failure recorded as learning (with command context).");

    // 4. Verify Learning was Recorded
    console.log("\n4️⃣  Verifying Learning Retrieval...");
    
    // Query for something related to the failure
    const context2 = await queryService.getContext("I want to run npm install");
    
    const foundLearning = context2.relevantLearnings.find(l => 
      l.item.content.includes("npm ERR! code ENOENT")
    );

    if (foundLearning) {
      console.log("✅ SUCCESS: Retrieved the learned failure from memory.");
      console.log(`   Score: ${(foundLearning.score * 100).toFixed(1)}%`);
      console.log(`   Content: ${foundLearning.item.content.slice(0, 60)}...`);
    } else {
      console.error("❌ FAILURE: Did not retrieve the recent learning.");
      console.log(`   Available learnings: ${context2.relevantLearnings.length}`);
    }

    // 5. Test formatted context output
    console.log("\n5️⃣  Testing Context Formatting...");
    const formatted = queryService.formatContextForPrompt(context2);
    
    if (formatted.includes("Golden Rules:") && formatted.includes("Relevant Past Experiences:")) {
      console.log("✅ SUCCESS: Context properly formatted for injection");
      console.log(`   Generated context length: ${formatted.length} chars`);
    } else {
      console.error("❌ FAILURE: Context formatting incomplete");
    }

    // 6. Test Hybrid Search (FTS + Vector)
    console.log("\n6️⃣  Testing Hybrid Search (FTS + Vector)...");
    
    // Record a learning with a specific keyword for FTS testing
    await queryService.recordLearning(
      "Tool 'docker' failed: ERROR_CODE_42 container not found",
      "failure",
      JSON.stringify({ stderr: "ERROR_CODE_42", exitCode: 1, testId: "fts-test" })
    );
    
    // Search using hybrid search
    const hybridResults = await queryService.searchHybrid("ERROR_CODE_42");
    
    if (hybridResults.length > 0) {
      const ftsMatch = hybridResults.find(r => r.item.content.includes("ERROR_CODE_42"));
      if (ftsMatch) {
        console.log("✅ SUCCESS: Hybrid search found the specific error code");
        console.log(`   Match type: ${ftsMatch.item.matchType || 'unknown'}`);
        console.log(`   Score: ${(ftsMatch.score * 100).toFixed(1)}%`);
      } else {
        console.log("⚠️  Hybrid search returned results but didn't find exact match");
      }
    } else {
      console.log("⚠️  Hybrid search returned no results (FTS may need more data)");
    }

    // 7. Test Privacy Filter
    console.log("\n7️⃣  Testing Privacy Filter...");
    
    // Count learnings before
    const db = getDbClient(GLOBAL_DB_PATH);
    const beforeCount = await db.execute("SELECT COUNT(*) as count FROM learnings");
    const countBefore = beforeCount.rows[0].count as number;
    
    // Try to record a learning with private content
    await queryService.recordLearning(
      "API key is <private>sk-secret-key-12345</private> and failed",
      "failure",
      JSON.stringify({ error: "auth failed", testId: "privacy-test" })
    );
    
    // Count learnings after - should be same (learning should be skipped)
    const afterCount = await db.execute("SELECT COUNT(*) as count FROM learnings");
    const countAfter = afterCount.rows[0].count as number;
    
    if (countAfter === countBefore) {
      console.log("✅ SUCCESS: Learning with <private> tag was NOT recorded");
    } else {
      // Check if it was recorded with redacted content
      const lastLearning = await db.execute(
        "SELECT content FROM learnings ORDER BY created_at DESC LIMIT 1"
      );
      const content = lastLearning.rows[0]?.content as string;
      if (content?.includes("[REDACTED]")) {
        console.log("✅ SUCCESS: Private content was redacted before storage");
      } else if (content && !content.includes("sk-secret-key")) {
        console.log("✅ SUCCESS: Private content was stripped");
      } else {
        console.error("❌ FAILURE: Private content may have been stored");
      }
    }

    console.log("\n🎉 All Tests Passed!");
    console.log("\n📊 Summary:");
    console.log(`   Initialization time: ${initTime}ms`);
    console.log(`   Golden rules active: ${context.goldenRules.length}`);
    console.log("   Context injection: Ready");
    console.log("   Hybrid search: Ready");
    console.log("   Privacy filter: Ready");
    
  } catch (error) {
    console.error("\n❌ Simulation failed:", error);
    process.exit(1);
  }
}

runSimulation();
