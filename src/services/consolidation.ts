import { getDbClient } from "../db/client.js";
import { embeddingService } from "./embeddings.js";
import { queryService } from "./query.js";
import { getDbPaths, GLOBAL_DB_PATH } from "../config.js";

export class ConsolidationService {
    private workingDirectory: string;

    constructor(workingDirectory?: string) {
        this.workingDirectory = workingDirectory || process.cwd();
    }

    /**
     * Find clusters of similar learnings that could become a Golden Rule
     */
    async findEmergentPatterns(threshold = 0.85, minCount = 3) {
        const paths = getDbPaths(this.workingDirectory);
        // Combine learnings from both global and project DBs
        const dbPaths = [GLOBAL_DB_PATH];
        if (paths.project) dbPaths.push(paths.project);

        const allLearnings: any[] = [];

        for (const dbPath of dbPaths) {
            const db = getDbClient(dbPath);
            // 1. Get all recent learnings (last 7 days by default)
            const result = await db.execute({
                sql: "SELECT * FROM learnings WHERE created_at > ?",
                args: [Date.now() - 7 * 24 * 60 * 60 * 1000]
            });

            allLearnings.push(...result.rows.map(row => ({
                id: row.id,
                content: row.content as string,
                embedding: JSON.parse(row.embedding as string),
                dbPath // Track which DB it's from
            })));
        }

        const clusters: { content: string[]; ids: string[]; dbPaths: string[] }[] = [];
        const processed = new Set<string>();

        // 2. Naive clustering (O(n^2) - fine for small local datasets)
        for (let i = 0; i < allLearnings.length; i++) {
            if (processed.has(allLearnings[i].id as string)) continue;

            const currentCluster = {
                content: [allLearnings[i].content],
                ids: [allLearnings[i].id as string],
                dbPaths: [allLearnings[i].dbPath]
            };

            for (let j = i + 1; j < allLearnings.length; j++) {
                if (processed.has(allLearnings[j].id as string)) continue;

                const similarity = embeddingService.cosineSimilarity(
                    allLearnings[i].embedding,
                    allLearnings[j].embedding
                );

                if (similarity >= threshold) {
                    currentCluster.content.push(allLearnings[j].content);
                    currentCluster.ids.push(allLearnings[j].id as string);
                    currentCluster.dbPaths.push(allLearnings[j].dbPath);
                    processed.add(allLearnings[j].id as string);
                }
            }

            if (currentCluster.ids.length >= minCount) {
                clusters.push(currentCluster);
            }
        }

        return clusters;
    }

    /**
     * Promote a cluster to a Golden Rule
     */
    async promoteToRule(cluster: { content: string[] }, scope: "global" | "project" = "project") {
        // In a real agent, you'd ask the LLM to summarize `cluster.content` into one rule.
        // For now, we take the first one or a generic label.
        const summary = `Emergent Rule: ${cluster.content[0]}`;
        await queryService.addGoldenRule(summary, scope);
        console.log(`ELF: Promoted ${cluster.content.length} learnings to a new Golden Rule!`);

        return summary;
    }
}

export const consolidationService = new ConsolidationService();
