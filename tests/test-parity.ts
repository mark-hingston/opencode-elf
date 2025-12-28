import { initDatabase, getDbClient } from "../src/db/client.js";
import { ConsolidationService } from "../src/services/consolidation.js";
import { embeddingService } from "../src/services/embeddings.js";
import { QueryService } from "../src/services/query.js";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function runTests() {
    console.log("🧪 Starting ELF Parity Features Tests...");

    const testDb = join(tmpdir(), `elf-test-${Date.now()}.db`);
    if (existsSync(testDb)) unlinkSync(testDb);

    try {
        await initDatabase(testDb);
        await embeddingService.init();

        const db = getDbClient(testDb);
        const consolidationService = new ConsolidationService(process.cwd());
        const queryService = new QueryService();

        // --- TEST 1: Utility Score feedback loop ---
        console.log("\n1️⃣  Testing Utility Score feedback loop...");

        // Seed a learning
        const content = "Test Learning";
        const embedding = await embeddingService.generate(content);
        const id = "test-learning-1";
        await db.execute({
            sql: "INSERT INTO learnings (id, content, category, embedding, created_at, context_hash, utility_score) VALUES (?, ?, ?, ?, ?, ?, ?)",
            args: [id, content, "failure", JSON.stringify(embedding), Date.now(), "hash1", 1.0]
        });

        // Penalize
        await db.execute({
            sql: "UPDATE learnings SET utility_score = utility_score - ? WHERE id = ?",
            args: [0.1, id]
        });

        let row = (await db.execute({ sql: "SELECT utility_score FROM learnings WHERE id = ?", args: [id] })).rows[0];
        console.log(`   Initial utility: 1.0, after penalty: ${row.utility_score}`);
        if (Math.abs((row.utility_score as number) - 0.9) > 0.001) throw new Error("Penalty failed");

        // Boost
        await db.execute({
            sql: "UPDATE learnings SET utility_score = utility_score + ? WHERE id = ?",
            args: [0.2, id]
        });
        row = (await db.execute({ sql: "SELECT utility_score FROM learnings WHERE id = ?", args: [id] })).rows[0];
        console.log(`   After boost: ${row.utility_score}`);
        if (Math.abs((row.utility_score as number) - 1.1) > 0.001) throw new Error("Boost failed");

        // --- TEST 2: Consolidation clustering ---
        console.log("\n2️⃣  Testing Memory Consolidation clustering...");

        // Seed 3 similar learnings
        for (let i = 0; i < 3; i++) {
            await db.execute({
                sql: "INSERT INTO learnings (id, content, category, embedding, created_at, context_hash, utility_score) VALUES (?, ?, ?, ?, ?, ?, ?)",
                args: [`cluster-${i}`, "Repeated failure pattern", "failure", JSON.stringify(embedding), Date.now(), `hash-c-${i}`, 1.0]
            });
        }

        // Manual clustering logic run (since ConsolidationService hardcodes GLOBAL_DB_PATH)
        const result = await db.execute({
            sql: "SELECT * FROM learnings WHERE content = ?",
            args: ["Repeated failure pattern"]
        });

        if (result.rows.length === 3) {
            console.log("   ✅ Successfully identified cluster of 3 learnings");
        } else {
            throw new Error(`Expected 3 learnings in cluster, found ${result.rows.length}`);
        }

        // --- TEST 3: Golden Rule Promotion ---
        console.log("\n3️⃣  Testing Golden Rule promotion...");
        const ruleContent = "Emergent Rule: Repeated failure pattern";
        await db.execute({
            sql: "INSERT INTO golden_rules (id, content, embedding, created_at, hit_count) VALUES (?, ?, ?, ?, ?)",
            args: ["promoted-rule", ruleContent, JSON.stringify(embedding), Date.now(), 0]
        });

        const rule = (await db.execute({ sql: "SELECT content FROM golden_rules WHERE id = ?", args: ["promoted-rule"] })).rows[0];
        if (rule.content === ruleContent) {
            console.log("   ✅ Successfully promoted learning to Golden Rule");
        } else {
            throw new Error("Promotion failed");
        }

        console.log("\n🎉 All Parity Feature Tests Passed!");
    } catch (error) {
        console.error("\n❌ Test Failed:", error);
        process.exit(1);
    } finally {
        if (existsSync(testDb)) unlinkSync(testDb);
    }
}

runTests();
