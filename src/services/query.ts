import { getDbClient, getDbClients } from "../db/client.js";
import { embeddingService } from "./embeddings.js";
import type { GoldenRule, Learning, Heuristic, SearchResult, ELFContext, MemoryScope } from "../types/elf.js";
import { MAX_GOLDEN_RULES, MAX_RELEVANT_LEARNINGS, SIMILARITY_THRESHOLD, getDbPaths, AUTO_CLEANUP_ENABLED } from "../config.js";
import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";
import { cleanupExpiredData } from "./cleanup.js";

export class QueryService {
  private workingDirectory: string;
  private lastCleanupTime = 0;
  private readonly CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Run cleanup once per day

  constructor(workingDirectory?: string) {
    this.workingDirectory = workingDirectory || process.cwd();
  }

  /**
   * Set the working directory for project-scoped queries
   */
  setWorkingDirectory(directory: string): void {
    this.workingDirectory = directory;
  }

  /**
   * Run cleanup if auto-cleanup is enabled and enough time has passed
   */
  private async maybeRunCleanup(): Promise<void> {
    if (!AUTO_CLEANUP_ENABLED) {
      return;
    }

    const now = Date.now();
    if (now - this.lastCleanupTime < this.CLEANUP_INTERVAL) {
      return; // Cleanup already ran recently
    }

    this.lastCleanupTime = now;

    // Run cleanup on all active databases
    const { clients } = this.getClients();
    await Promise.all(clients.map(db => cleanupExpiredData(db)));
  }

  /**
   * Get all active database clients (global + project if available)
   */
  private getClients(): { clients: Client[]; scopes: MemoryScope[] } {
    const paths = getDbPaths(this.workingDirectory);
    const clients = getDbClients(paths);
    const scopes: MemoryScope[] = ["global"];
    
    if (paths.project) {
      scopes.push("project");
    }
    
    return { clients, scopes };
  }

  /**
   * Get relevant context for a given user prompt
   */
  async getContext(prompt: string): Promise<ELFContext> {
    // Run automatic cleanup if enabled and enough time has passed
    await this.maybeRunCleanup();

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
   * Get top N golden rules (constitutional principles) from both databases
   * Project rules come first, then global rules
   */
  private async getTopGoldenRules(): Promise<GoldenRule[]> {
    const { clients, scopes } = this.getClients();
    
    // Query all databases in parallel
    const results = await Promise.all(
      clients.map(async (db, i) => {
        const result = await db.execute({
          sql: "SELECT * FROM golden_rules ORDER BY hit_count DESC",
          args: [],
        });
        
        return result.rows.map(row => ({
          id: row.id as string,
          content: row.content as string,
          embedding: JSON.parse(row.embedding as string),
          created_at: row.created_at as number,
          hit_count: row.hit_count as number,
          scope: scopes[i],
        }));
      })
    );
    
    // Flatten results
    const allRules = results.flat();
    
    // Sort by hit count and take top N
    // Prioritize project rules by giving them a slight boost in sorting
    allRules.sort((a, b) => {
      if (a.scope === "project" && b.scope === "global") return -1;
      if (a.scope === "global" && b.scope === "project") return 1;
      return b.hit_count - a.hit_count;
    });
    
    return allRules.slice(0, MAX_GOLDEN_RULES);
  }

  /**
   * Search for relevant learnings using vector similarity across all databases
   */
  private async searchLearnings(prompt: string): Promise<SearchResult<Learning>[]> {
    const { clients, scopes } = this.getClients();
    const promptEmbedding = await embeddingService.generate(prompt);
    
    // Query all databases in parallel
    const results = await Promise.all(
      clients.map(async (db, i) => {
        const result = await db.execute("SELECT * FROM learnings");
        
        return result.rows
          .map(row => {
            const learning: Learning = {
              id: row.id as string,
              content: row.content as string,
              category: row.category as 'success' | 'failure',
              embedding: JSON.parse(row.embedding as string),
              created_at: row.created_at as number,
              context_hash: row.context_hash as string,
              scope: scopes[i],
            };
            
            const score = embeddingService.cosineSimilarity(promptEmbedding, learning.embedding);
            
            return { item: learning, score };
          })
          .filter(result => result.score >= SIMILARITY_THRESHOLD);
      })
    );
    
    // Flatten results
    const allLearnings = results.flat();
    
    // Sort by score (project learnings get slight boost)
    allLearnings.sort((a, b) => {
      // Prioritize project learnings slightly
      if (a.item.scope === "project" && b.item.scope === "global") {
        return b.score - (a.score + 0.05); // Small boost for project
      }
      if (a.item.scope === "global" && b.item.scope === "project") {
        return (b.score + 0.05) - a.score;
      }
      return b.score - a.score;
    });
    
    return allLearnings.slice(0, MAX_RELEVANT_LEARNINGS);
  }

  /**
   * Get heuristics that match keywords in the prompt from all databases
   */
  private async getMatchingHeuristics(prompt: string): Promise<Heuristic[]> {
    const { clients, scopes } = this.getClients();
    const seenPatterns = new Set<string>();
    
    // Query all databases in parallel
    const results = await Promise.all(
      clients.map(async (db, i) => {
        const result = await db.execute("SELECT * FROM heuristics");
        
        const heuristics: Heuristic[] = [];
        
        for (const row of result.rows) {
          const pattern = row.pattern as string;
          
          // Skip duplicates (project takes precedence - it comes first in array)
          if (seenPatterns.has(pattern)) continue;
          seenPatterns.add(pattern);
          
          const heuristic: Heuristic = {
            id: row.id as string,
            pattern,
            suggestion: row.suggestion as string,
            created_at: row.created_at as number,
            scope: scopes[i],
          };
          
          // Check if pattern matches prompt
          try {
            const regex = new RegExp(heuristic.pattern, "i");
            if (regex.test(prompt)) {
              heuristics.push(heuristic);
            }
          } catch (error) {
            // Invalid regex, skip
            console.error(`Invalid heuristic pattern: ${heuristic.pattern}`, error);
          }
        }
        
        return heuristics;
      })
    );
    
    // Flatten results
    return results.flat();
  }

  /**
   * Record a new learning from a tool execution
   */
  async recordLearning(
    content: string,
    category: 'success' | 'failure',
    context: string,
    scope: MemoryScope = "project"
  ): Promise<void> {
    const paths = getDbPaths(this.workingDirectory);
    const dbPath = scope === "project" && paths.project ? paths.project : paths.global;
    const db = getDbClient(dbPath);
    
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
  async addGoldenRule(content: string, scope: MemoryScope = "global"): Promise<void> {
    const paths = getDbPaths(this.workingDirectory);
    const dbPath = scope === "project" && paths.project ? paths.project : paths.global;
    const db = getDbClient(dbPath);
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
    const { clients } = this.getClients();
    
    // Update hit counts in all databases in parallel
    await Promise.all(
      clients.flatMap(db =>
        ruleIds.map(id =>
          db.execute({
            sql: "UPDATE golden_rules SET hit_count = hit_count + 1 WHERE id = ?",
            args: [id],
          })
        )
      )
    );
  }

  /**
   * Format context for injection into the prompt
   */
  formatContextForPrompt(context: ELFContext): string {
    const parts: string[] = ["[ELF MEMORY]"];
    
    if (context.goldenRules.length > 0) {
      parts.push("\nGolden Rules:");
      for (const rule of context.goldenRules) {
        const scopeTag = rule.scope === "project" ? " [project]" : "";
        parts.push(`- ${rule.content}${scopeTag}`);
      }
    }
    
    if (context.relevantLearnings.length > 0) {
      parts.push("\nRelevant Past Experiences:");
      for (const { item, score } of context.relevantLearnings) {
        const emoji = item.category === 'success' ? '✓' : '✗';
        const scopeTag = item.scope === "project" ? " [project]" : "";
        parts.push(`${emoji} [${(score * 100).toFixed(0)}%] ${item.content}${scopeTag}`);
      }
    }
    
    if (context.heuristics.length > 0) {
      parts.push("\nApplicable Heuristics:");
      for (const heuristic of context.heuristics) {
        const scopeTag = heuristic.scope === "project" ? " [project]" : "";
        parts.push(`- ${heuristic.suggestion}${scopeTag}`);
      }
    }
    
    return parts.join("\n");
  }
}

// Create default instance with current working directory
export const queryService = new QueryService();
