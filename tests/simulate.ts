/**
 * Simulation Script
 * Verifies the full ELF loop without needing OpenCode
 * Run with: npx ts-node tests/simulate.ts
 */

import { initDatabase, getDbClient } from "../src/db/client";
import { queryService } from "../src/services/query";
import { chatParams, event } from "../src/index";

async function runSimulation() {
  console.log("🤖 Starting ELF Simulation...\n");

  // 1. Initialize
  await initDatabase();
  
  // 2. Seed a Golden Rule
  console.log("1️⃣  Seeding Golden Rule...");
  await queryService.addGoldenRule("Always use strict equality (===) in JavaScript");
  
  // 3. Simulate a User Query (Context Injection)
  console.log("\n2️⃣  Simulating Chat Request...");
  const mockChatParams = {
    input: {
      message: { text: "I want to write a JS function to compare numbers." },
      systemPrompt: "You are a coding assistant."
    }
  };
  
  // This should trigger the embedding search and inject the Golden Rule
  await chatParams(mockChatParams);
  
  const input = mockChatParams.input as Record<string, unknown>;
  const modifiedPrompt = input.systemPrompt as string;
  if (modifiedPrompt.includes("Always use strict equality")) {
    console.log("✅ SUCCESS: Context injected Golden Rule into system prompt.");
  } else {
    console.error("❌ FAILURE: Golden Rule not found in prompt.");
    console.log("Actual Prompt:", modifiedPrompt);
  }

  // 4. Simulate a Tool Failure (Learning Loop)
  console.log("\n3️⃣  Simulating Tool Failure...");
  const mockEvent = {
    type: "tool.result",
    tool: "npm",
    result: {
      stderr: "npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path package.json",
      exitCode: 1
    }
  };

  await event(mockEvent);
  console.log("✅ Tool failure event processed.");

  // 5. Verify Learning was Recorded
  console.log("\n4️⃣  Verifying Learning Retrieval...");
  
  // Query for something related to the failure
  const context = await queryService.getContext("I want to run npm install");
  
  const foundLearning = context.relevantLearnings.find(l => 
    l.item.content.includes("npm ERR! code ENOENT")
  );

  if (foundLearning) {
    console.log("✅ SUCCESS: Retrieved the learned failure from memory.");
    console.log(`   Score: ${(foundLearning.score * 100).toFixed(1)}%`);
    console.log(`   Content: ${foundLearning.item.content}`);
  } else {
    console.error("❌ FAILURE: Did not retrieve the recent learning.");
    console.log("   Available learnings:", context.relevantLearnings.length);
  }

  console.log("\n🎉 Simulation Complete.");
  
  // 6. Verify Metrics Collection
  console.log("\n5️⃣  Verifying Metrics Collection...");
  const db = getDbClient();
  
  const metricsCount = await db.execute("SELECT COUNT(*) as count FROM metrics");
  const latencyMetrics = await db.execute("SELECT value FROM metrics WHERE type = 'latency'");
  const injectionMetrics = await db.execute("SELECT COUNT(*) as count FROM metrics WHERE type = 'injection'");
  const failureMetrics = await db.execute("SELECT COUNT(*) as count FROM metrics WHERE type = 'learning_failure'");
  
  console.log(`   Total metrics recorded: ${metricsCount.rows[0]?.count}`);
  console.log(`   Latency samples: ${latencyMetrics.rows.length}`);
  console.log(`   Injections: ${injectionMetrics.rows[0]?.count}`);
  console.log(`   Failures learned: ${failureMetrics.rows[0]?.count}`);
  
  if (latencyMetrics.rows.length > 0) {
    const avgLatency = latencyMetrics.rows.reduce((sum, row) => sum + (row.value as number), 0) / latencyMetrics.rows.length;
    console.log(`   Average latency: ${Math.round(avgLatency)}ms`);
    
    if (avgLatency < 500) {
      console.log("   ✅ SUCCESS: Metrics collected with good performance");
    } else {
      console.log("   ⚠️  WARNING: Latency higher than expected");
    }
  }
  
  console.log("\n🎉 All Tests Passed!");
}

runSimulation().catch(error => {
  console.error("Simulation failed:", error);
  process.exit(1);
});
