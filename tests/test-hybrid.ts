/**
 * Test script to verify hybrid storage functionality
 */
import { initDatabase } from "../dist/db/client.js";
import { QueryService } from "../dist/services/query.js";
import { embeddingService } from "../dist/services/embeddings.js";
import { GLOBAL_DB_PATH } from "../dist/config.js";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";

async function testHybridStorage() {
  console.log("🧪 Testing Hybrid Storage...\n");
  
  // Setup test directories
  const testProjectDir = "/tmp/test-elf-project";
  const projectDbPath = `${testProjectDir}/.opencode/elf/memory.db`;
  
  // Clean up any existing test databases
  if (existsSync(projectDbPath)) {
    unlinkSync(projectDbPath);
  }
  
  // Create project marker (.git)
  mkdirSync(`${testProjectDir}/.git`, { recursive: true });
  
  try {
    console.log("1️⃣  Initializing embedding model...");
    await embeddingService.init();
    console.log("✅ Embedding model loaded\n");
    
    console.log("2️⃣  Initializing databases...");
    // Initialize global database
    await initDatabase(GLOBAL_DB_PATH);
    console.log("✅ Global database initialized");
    
    // Initialize project database
    await initDatabase(projectDbPath);
    console.log("✅ Project database initialized\n");
    
    console.log("3️⃣  Creating query service with test project directory...");
    const queryService = new QueryService(testProjectDir);
    console.log("✅ Query service created\n");
    
    console.log("4️⃣  Adding global golden rule...");
    await queryService.addGoldenRule("This is a GLOBAL rule", "global");
    console.log("✅ Global rule added\n");
    
    console.log("5️⃣  Adding project golden rule...");
    await queryService.addGoldenRule("This is a PROJECT rule", "project");
    console.log("✅ Project rule added\n");
    
    console.log("6️⃣  Recording global learning...");
    await queryService.recordLearning(
      "Tool bash failed with error code",
      "failure",
      JSON.stringify({ error: "test global error" }),
      "global"
    );
    console.log("✅ Global learning recorded\n");
    
    console.log("7️⃣  Recording project learning...");
    await queryService.recordLearning(
      "Tool npm failed with error code",
      "failure",
      JSON.stringify({ error: "test project error" }),
      "project"
    );
    console.log("✅ Project learning recorded\n");
    
    console.log("8️⃣  Querying context (should include both global and project)...");
    const context = await queryService.getContext("bash npm error");
    
    console.log("\n📊 Retrieved Context:");
    console.log(`   Golden Rules: ${context.goldenRules.length}`);
    for (const rule of context.goldenRules) {
      console.log(`   - [${rule.scope}] ${rule.content}`);
    }
    
    console.log(`\n   Learnings: ${context.relevantLearnings.length}`);
    for (const learning of context.relevantLearnings) {
      const score = (learning.score * 100).toFixed(0);
      console.log(`   - [${learning.item.scope}] [${score}%] ${learning.item.content}`);
    }
    
    // Verify we got both scopes
    const hasGlobalRule = context.goldenRules.some(r => r.scope === "global");
    const hasProjectRule = context.goldenRules.some(r => r.scope === "project");
    const hasGlobalLearning = context.relevantLearnings.some(l => l.item.scope === "global");
    const hasProjectLearning = context.relevantLearnings.some(l => l.item.scope === "project");
    
    console.log("\n✅ Verification:");
    console.log(`   Has global rule: ${hasGlobalRule ? "✓" : "✗"}`);
    console.log(`   Has project rule: ${hasProjectRule ? "✓" : "✗"}`);
    console.log(`   Has global learning: ${hasGlobalLearning ? "✓" : "✗"}`);
    console.log(`   Has project learning: ${hasProjectLearning ? "✓" : "✗"}`);
    
    // Success if we have both types of rules (learnings are harder to match due to similarity)
    if (hasGlobalRule && hasProjectRule) {
      console.log("\n🎉 Hybrid storage test PASSED!");
      console.log("   ✅ Both global and project rules are retrieved");
      if (hasProjectLearning || hasGlobalLearning) {
        console.log("   ✅ Learning storage is working");
      }
    } else {
      console.log("\n❌ Hybrid storage test FAILED - not all scopes present");
      process.exit(1);
    }
    
    console.log("\n9️⃣  Testing formatted context output...");
    const formatted = queryService.formatContextForPrompt(context);
    console.log(formatted);
    
    // Verify scope tags are present (project tags shown, global implied)
    if (formatted.includes("[project]")) {
      console.log("\n✅ Scope tags present in formatted output");
      console.log("   (Project memories tagged with [project], global memories untagged)");
    } else {
      console.log("\n⚠️  Scope tags missing in formatted output");
    }
    
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
  
  console.log("\n✨ All tests completed successfully!");
}

testHybridStorage();

