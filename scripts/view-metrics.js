#!/usr/bin/env node

/**
 * View ELF Performance Metrics
 * Usage: node scripts/view-metrics.js
 */

const { initDatabase, getDbClient } = require("../dist/db/client");

async function main() {
  await initDatabase();
  const db = getDbClient();

  console.log("\n📊 ELF Performance Metrics");
  console.log("==========================");

  // Latency stats
  const lat = await db.execute(
    "SELECT AVG(value) as avg, MAX(value) as max, MIN(value) as min, COUNT(*) as count FROM metrics WHERE type = 'latency'"
  );
  
  if (lat.rows[0].count > 0) {
    console.log("\n⏱️  Latency (Context Injection)");
    console.log(`   Average: ${Math.round(lat.rows[0].avg || 0)}ms`);
    console.log(`   Min:     ${Math.round(lat.rows[0].min || 0)}ms`);
    console.log(`   Max:     ${Math.round(lat.rows[0].max || 0)}ms`);
    console.log(`   Samples: ${lat.rows[0].count}`);
  } else {
    console.log("\n⏱️  Latency: No data yet");
  }

  // Activity stats
  const injections = await db.execute(
    "SELECT COUNT(*) as c FROM metrics WHERE type = 'injection'"
  );
  const failures = await db.execute(
    "SELECT COUNT(*) as c FROM metrics WHERE type = 'learning_failure'"
  );
  
  console.log("\n📈 Activity");
  console.log(`   Context Injections: ${injections.rows[0].c}`);
  console.log(`   Failures Learned:   ${failures.rows[0].c}`);

  // Context composition (from injection metadata)
  const injectionMeta = await db.execute(
    "SELECT meta FROM metrics WHERE type = 'injection' AND meta IS NOT NULL LIMIT 10"
  );
  
  if (injectionMeta.rows.length > 0) {
    console.log("\n🎯 Context Composition (Last Injection)");
    const lastMeta = JSON.parse(injectionMeta.rows[0].meta);
    console.log(`   Golden Rules:   ${lastMeta.rules || 0}`);
    console.log(`   Learnings:      ${lastMeta.learnings || 0}`);
    console.log(`   Heuristics:     ${lastMeta.heuristics || 0}`);
  }

  // Recent activity
  console.log("\n🕒 Recent Events (Last 10)");
  const recent = await db.execute(
    "SELECT * FROM metrics ORDER BY created_at DESC LIMIT 10"
  );
  
  if (recent.rows.length === 0) {
    console.log("   No activity recorded yet");
  } else {
    for (const row of recent.rows) {
      const time = new Date(row.created_at).toLocaleTimeString();
      const value = row.type === 'latency' ? `${Math.round(row.value)}ms` : row.value;
      console.log(`   [${time}] ${row.type}: ${value}`);
    }
  }

  // Performance warnings
  console.log("\n⚠️  Performance Analysis");
  const avgLatency = lat.rows[0].avg || 0;
  
  if (avgLatency === 0) {
    console.log("   No data to analyze yet");
  } else if (avgLatency < 200) {
    console.log("   ✅ Excellent - Latency under 200ms");
  } else if (avgLatency < 500) {
    console.log("   ✅ Good - Latency under 500ms");
  } else if (avgLatency < 1000) {
    console.log("   ⚠️  Warning - Latency over 500ms");
    console.log("      Consider optimizing embedding model or caching");
  } else {
    console.log("   ❌ Critical - Latency over 1000ms");
    console.log("      Immediate optimization needed");
  }

  // Total database size
  const totalMetrics = await db.execute("SELECT COUNT(*) as c FROM metrics");
  console.log("\n📦 Database");
  console.log(`   Total Metrics: ${totalMetrics.rows[0].c}`);

  console.log(`\n${"─".repeat(50)}`);
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
