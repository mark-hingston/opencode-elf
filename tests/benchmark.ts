/**
 * Performance Benchmark Script
 * Tests the performance improvements from parallel queries and caching
 */

import { initDatabase, isDatabaseEmpty, seedGoldenRules, seedHeuristics } from "../dist/db/client.js";
import { QueryService } from "../dist/services/query.js";
import { embeddingService } from "../dist/services/embeddings.js";
import { GLOBAL_DB_PATH, getDbPaths } from "../dist/config.js";

async function benchmark() {
  console.log("🏁 Performance Benchmark\n");

  try {
    // Setup
    const testDir = process.cwd();
    const paths = getDbPaths(testDir);
    
    await initDatabase(GLOBAL_DB_PATH);
    if (paths.project) {
      await initDatabase(paths.project);
    }
    
    await embeddingService.init();
    
    const queryService = new QueryService(testDir);
    
    // Ensure we have data
    const isEmpty = await isDatabaseEmpty(GLOBAL_DB_PATH);
    if (isEmpty) {
      await seedGoldenRules(queryService.addGoldenRule.bind(queryService));
      await seedHeuristics(GLOBAL_DB_PATH);
    }
    
    // Add some test learnings to both databases
    console.log("📝 Setting up test data...");
    await queryService.recordLearning(
      "Tool 'npm' failed with ENOENT error",
      "failure",
      JSON.stringify({ error: "test1" }),
      "global"
    );
    await queryService.recordLearning(
      "Tool 'bash' succeeded with exit code 0",
      "success",
      JSON.stringify({ success: "test2" }),
      "global"
    );
    
    if (paths.project) {
      await queryService.recordLearning(
        "Project-specific npm configuration issue",
        "failure",
        JSON.stringify({ error: "test3" }),
        "project"
      );
    }
    
    console.log("✅ Test data ready\n");
    
    // Benchmark 1: Context retrieval (tests parallel queries)
    console.log("1️⃣  Benchmarking Context Retrieval (Parallel Queries)");
    const contextTimes: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await queryService.getContext("I want to use npm to install packages");
      const duration = Date.now() - start;
      contextTimes.push(duration);
    }
    
    const avgContextTime = contextTimes.reduce((a, b) => a + b, 0) / contextTimes.length;
    const minContextTime = Math.min(...contextTimes);
    const maxContextTime = Math.max(...contextTimes);
    
    console.log(`   Average: ${avgContextTime.toFixed(2)}ms`);
    console.log(`   Min: ${minContextTime}ms | Max: ${maxContextTime}ms`);
    console.log(`   Queries: ${contextTimes.length}\n`);
    
    // Benchmark 2: Embedding caching
    console.log("2️⃣  Benchmarking Embedding Cache");
    
    // Clear cache first
    embeddingService.clearCache();
    
    const testPrompt = "How do I use npm to install dependencies?";
    
    // First call (cache miss)
    const start1 = Date.now();
    await embeddingService.generate(testPrompt);
    const cacheMissTime = Date.now() - start1;
    
    // Second call (cache hit)
    const start2 = Date.now();
    await embeddingService.generate(testPrompt);
    const cacheHitTime = Date.now() - start2;
    
    // Third call (should still hit cache)
    const start3 = Date.now();
    await embeddingService.generate(testPrompt);
    const cacheHit2Time = Date.now() - start3;
    
    console.log(`   Cache Miss: ${cacheMissTime}ms`);
    console.log(`   Cache Hit 1: ${cacheHitTime}ms`);
    console.log(`   Cache Hit 2: ${cacheHit2Time}ms`);
    console.log(`   Speedup: ${(cacheMissTime / cacheHitTime).toFixed(1)}x faster\n`);
    
    // Benchmark 3: Multiple different prompts (tests cache behavior)
    console.log("3️⃣  Benchmarking Mixed Queries (Cache + Parallel)");
    
    const prompts = [
      "How do I fix npm errors?",
      "What is the best way to use git?",
      "How do I debug TypeScript issues?",
      "How do I fix npm errors?", // Repeat - should hit cache
      "What is the best way to use git?", // Repeat - should hit cache
    ];
    
    const mixedTimes: number[] = [];
    
    for (const prompt of prompts) {
      const start = Date.now();
      await queryService.getContext(prompt);
      const duration = Date.now() - start;
      mixedTimes.push(duration);
    }
    
    console.log("   Query times:");
    prompts.forEach((prompt, i) => {
      const cached = i >= 3 ? " [cached]" : " [fresh]";
      console.log(`   ${i + 1}. ${mixedTimes[i]}ms${cached}`);
    });
    
    const freshAvg = (mixedTimes[0] + mixedTimes[1] + mixedTimes[2]) / 3;
    const cachedAvg = (mixedTimes[3] + mixedTimes[4]) / 2;
    
    console.log(`\n   Fresh queries avg: ${freshAvg.toFixed(2)}ms`);
    console.log(`   Cached queries avg: ${cachedAvg.toFixed(2)}ms`);
    console.log(`   Improvement: ${((freshAvg - cachedAvg) / freshAvg * 100).toFixed(1)}% faster\n`);
    
    // Cache stats
    const cacheStats = embeddingService.getCacheStats();
    console.log("4️⃣  Cache Statistics");
    console.log(`   Cache size: ${cacheStats.size}/${cacheStats.maxSize}`);
    console.log(`   Cache utilization: ${((cacheStats.size / cacheStats.maxSize) * 100).toFixed(1)}%\n`);
    
    console.log("✅ Benchmark Complete!\n");
    console.log("📊 Summary:");
    console.log(`   Context retrieval: ~${avgContextTime.toFixed(0)}ms`);
    console.log(`   Embedding cache hit: ~${cacheHitTime}ms (${(cacheMissTime / cacheHitTime).toFixed(1)}x speedup)`);
    console.log(`   Overall cache benefit: ~${((freshAvg - cachedAvg) / freshAvg * 100).toFixed(0)}% faster`);
    
  } catch (error) {
    console.error("\n❌ Benchmark failed:", error);
    process.exit(1);
  }
}

benchmark();
