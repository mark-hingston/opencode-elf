import { getDbClient } from "../db/client.js";
import { embeddingService } from "./embeddings.js";
import type { GoldenRule, Learning, Heuristic, SearchResult, ELFContext } from "../types/elf.js";
import { MAX_GOLDEN_RULES, MAX_RELEVANT_LEARNINGS, SIMILARITY_THRESHOLD } from "../config.js";
import { createHash } from "node:crypto";

export class QueryService {
  /**
   * Get relevant context for a given user prompt
   */
  async getContext(prompt: string): Promise<ELFContext> {
    const [goldenRules, relevantLearnings, heuristics] = await Promise.all([
      this.getTopGoldenRules(),
      this.searchLearnings(prompt),
      this.getMatchingHeuristics(prompt),
    ]);

    return {
      goldenRules,
      relevantLearnings,
      heuristics,
    };
  }

  /**
   * Get top N golden rules (constitutional principles)
   * These should always be included in context
   */
  private async getTopGoldenRules(): Promise<GoldenRule[]> {
    const db = getDbClient();
    const result = await db.execute({
      sql: "SELECT * FROM golden_rules ORDER BY hit_count DESC LIMIT ?",
      args: [MAX_GOLDEN_RULES],
    });

    return result.rows.map(row => ({
      id: row.id as string,
      content: row.content as string,
      embedding: JSON.parse(row.embedding as string),
      created_at: row.created_at as number,
      hit_count: row.hit_count as number,
    }));
  }

  /**
   * Search for relevant learnings using vector similarity
   */
  private async searchLearnings(prompt: string): Promise<SearchResult<Learning>[]> {
    const db = getDbClient();
    
    // Generate embedding for the prompt
    const promptEmbedding = await embeddingService.generate(prompt);
    
    // Get all learnings (in a production system, you'd want to optimize this)
    const result = await db.execute("SELECT * FROM learnings");
    
    const scoredLearnings: SearchResult<Learning>[] = result.rows
      .map(row => {
        const learning: Learning = {
          id: row.id as string,
          content: row.content as string,
          category: row.category as 'success' | 'failure',
          embedding: JSON.parse(row.embedding as string),
          created_at: row.created_at as number,
          context_hash: row.context_hash as string,
        };
        
        const score = embeddingService.cosineSimilarity(promptEmbedding, learning.embedding);
        
        return { item: learning, score };
      })
      .filter(result => result.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RELEVANT_LEARNINGS);

    return scoredLearnings;
  }

  /**
   * Get heuristics that match keywords in the prompt
   */
  private async getMatchingHeuristics(prompt: string): Promise<Heuristic[]> {
    const db = getDbClient();
    const result = await db.execute("SELECT * FROM heuristics");
    
    const matching: Heuristic[] = [];
    
    for (const row of result.rows) {
      const heuristic: Heuristic = {
        id: row.id as string,
        pattern: row.pattern as string,
        suggestion: row.suggestion as string,
        created_at: row.created_at as number,
      };
      
      // Check if pattern matches prompt
      try {
        const regex = new RegExp(heuristic.pattern, "i");
        if (regex.test(prompt)) {
          matching.push(heuristic);
        }
      } catch (error) {
        // Invalid regex, skip
        console.error(`Invalid heuristic pattern: ${heuristic.pattern}`, error);
      }
    }
    
    return matching;
  }

  /**
   * Record a new learning from a tool execution
   */
  async recordLearning(
    content: string,
    category: 'success' | 'failure',
    context: string
  ): Promise<void> {
    const db = getDbClient();
    
    // Generate hash to avoid duplicates
    const contextHash = createHash('sha256').update(context).digest('hex').slice(0, 16);
    
    // Check if we already have this learning
    const existing = await db.execute({
      sql: "SELECT id FROM learnings WHERE context_hash = ?",
      args: [contextHash],
    });
    
    if (existing.rows.length > 0) {
      return; // Already recorded
    }
    
    // Generate embedding
    const embedding = await embeddingService.generate(content);
    
    // Store learning
    const id = createHash('sha256')
      .update(content + Date.now().toString())
      .digest('hex')
      .slice(0, 16);
    
    await db.execute({
      sql: `INSERT INTO learnings (id, content, category, embedding, created_at, context_hash)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        content,
        category,
        JSON.stringify(embedding),
        Date.now(),
        contextHash,
      ],
    });
  }

  /**
   * Add a new golden rule
   */
  async addGoldenRule(content: string): Promise<void> {
    const db = getDbClient();
    const embedding = await embeddingService.generate(content);
    
    const id = createHash('sha256')
      .update(content + Date.now().toString())
      .digest('hex')
      .slice(0, 16);
    
    await db.execute({
      sql: `INSERT INTO golden_rules (id, content, embedding, created_at, hit_count)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        id,
        content,
        JSON.stringify(embedding),
        Date.now(),
        0,
      ],
    });
  }

  /**
   * Increment hit count for golden rules that were used
   */
  async incrementGoldenRuleHits(ruleIds: string[]): Promise<void> {
    const db = getDbClient();
    
    for (const id of ruleIds) {
      await db.execute({
        sql: "UPDATE golden_rules SET hit_count = hit_count + 1 WHERE id = ?",
        args: [id],
      });
    }
  }

  /**
   * Format context for injection into the prompt
   */
  formatContextForPrompt(context: ELFContext): string {
    const parts: string[] = ["[ELF MEMORY]"];
    
    if (context.goldenRules.length > 0) {
      parts.push("\nGolden Rules:");
      for (const rule of context.goldenRules) {
        parts.push(`- ${rule.content}`);
      }
    }
    
    if (context.relevantLearnings.length > 0) {
      parts.push("\nRelevant Past Experiences:");
      for (const { item, score } of context.relevantLearnings) {
        const emoji = item.category === 'success' ? '✓' : '✗';
        parts.push(`${emoji} [${(score * 100).toFixed(0)}%] ${item.content}`);
      }
    }
    
    if (context.heuristics.length > 0) {
      parts.push("\nApplicable Heuristics:");
      for (const heuristic of context.heuristics) {
        parts.push(`- ${heuristic.suggestion}`);
      }
    }
    
    return parts.join("\n");
  }
}

export const queryService = new QueryService();
