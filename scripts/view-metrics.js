#!/usr/bin/env node

/**
 * View ELF Performance Metrics
 * Usage: node scripts/view-metrics.js
 */

import { initDatabase, getDbClient } from "../dist/db/client.js";

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

  console.log(`\n${"─".repeat(50)}`);
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
