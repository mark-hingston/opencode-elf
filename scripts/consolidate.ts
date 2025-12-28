import { consolidationService } from "../src/services/consolidation.js";
import { embeddingService } from "../src/services/embeddings.js";

/**
 * Script to run memory consolidation
 * Promoting frequent learnings to Golden Rules
 */
async function runConsolidation() {
    console.log("ELF: Starting memory consolidation...");

    // Ensure embedding service is ready
    await embeddingService.init();

    const threshold = 0.85;
    const minCount = 3;

    const clusters = await consolidationService.findEmergentPatterns(threshold, minCount);

    if (clusters.length === 0) {
        console.log("ELF: No emergent patterns found for consolidation.");
        return;
    }

    console.log(`ELF: Found ${clusters.length} emergent patterns.`);

    for (const cluster of clusters) {
        console.log(`\nPattern found in ${cluster.content.length} learnings:`);
        cluster.content.forEach(c => console.log(`  - ${c}`));

        // In a real CLI, we might ask for confirmation.
        // For now, we auto-promote to show the loop works.
        const rule = await consolidationService.promoteToRule(cluster, "global");
        console.log(`ELF: Promoted to Golden Rule: "${rule}"`);
    }

    console.log("\nELF: Consolidation complete.");
}

runConsolidation().catch(console.error);
