import { initDatabase, isDatabaseEmpty, seedGoldenRules, seedHeuristics, getDbClient } from "./db/client.js";
import { embeddingService } from "./services/embeddings.js";
import { queryService } from "./services/query.js";
import { metricsService } from "./services/metrics.js";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { createHash } from "node:crypto";

// @ts-ignore - tool is exported at runtime but TypeScript doesn't see it
import { tool } from "@opencode-ai/plugin";

/**
 * OpenCode ELF Plugin
 * 
 * Emergent Learning Framework - Learns from past successes and failures
 */
export const ELFPlugin: Plugin = async ({ directory }: PluginInput) => {
  // Track if initialization is complete
  let initialized = false;
  
  async function initialize() {
    if (initialized) return;
    
    console.log("ELF: Initializing plugin...");
    
    try {
      // Initialize database
      await initDatabase();
      console.log("ELF: Database initialized");
      
      // Pre-load embedding model
      await embeddingService.init();
      console.log("ELF: Embedding model loaded");
      
      // Check if this is first run (empty database)
      const isEmpty = await isDatabaseEmpty();
      if (isEmpty) {
        console.log("ELF: First run detected - seeding default data...");
        
        // Seed default golden rules and heuristics
        await seedGoldenRules(queryService.addGoldenRule.bind(queryService));
        await seedHeuristics();
        
        console.log("ELF: Default data seeded successfully");
      }
      
      initialized = true;
      console.log("ELF: Plugin ready");
    } catch (error) {
      console.error("ELF: Initialization failed", error);
      throw error;
    }
  }

  // Initialize immediately
  await initialize();

  return {
    /**
     * Chat params hook - Inject ELF context before the LLM processes the message
     */
    "chat.params": async (params: Record<string, unknown>) => {
      const start = Date.now(); // Start timer for metrics
      
      try {
        await initialize();
        
        const input = params.input as Record<string, unknown> | undefined;
        const message = input?.message as Record<string, unknown> | undefined;
        const userMessage = message?.text as string | undefined;
        
        if (!userMessage) return;
        
        // Get relevant context from ELF
        const context = await queryService.getContext(userMessage);
        
        // Track which golden rules we're using
        if (context.goldenRules.length > 0) {
          const ruleIds = context.goldenRules.map((r: { id: string }) => r.id);
          await queryService.incrementGoldenRuleHits(ruleIds);
        }
        
        // Format context for injection
        const elfMemory = queryService.formatContextForPrompt(context);
        
        // Only inject if we have meaningful context
        if (context.goldenRules.length > 0 || 
            context.relevantLearnings.length > 0 || 
            context.heuristics.length > 0) {
          
          // Inject into system prompt or prepend to user message
          const systemPrompt = input?.systemPrompt as string | undefined;
          if (systemPrompt && input) {
            input.systemPrompt = `${systemPrompt}\n\n${elfMemory}`;
          } else if (message) {
            message.text = `${elfMemory}\n\n${userMessage}`;
          }
          
          // Record metrics - injection happened
          const duration = Date.now() - start;
          metricsService.record('latency', duration);
          metricsService.record('injection', 1, {
            rules: context.goldenRules.length,
            learnings: context.relevantLearnings.length,
            heuristics: context.heuristics.length
          });
        }
      } catch (error) {
        console.error("ELF: Error in chat.params hook", error);
        // Don't throw - we don't want to break the chat
      }
    },

    /**
     * Event hook - Learn from tool executions
     */
    event: async ({ event }) => {
      try {
        await initialize();
        
        // Only process tool result events
        // @ts-ignore - tool.execute.after is a valid event type
        if (event.type !== "tool.execute.after") return;
        
        const toolName = (event as unknown as { tool: string }).tool;
        const result = (event as unknown as { result: Record<string, unknown> }).result;
        
        // Skip if no result or tool name
        if (!result || !toolName) return;
        
        // Detect failures (stderr, error codes, exceptions)
        const stderr = result.stderr as string | undefined;
        const error = result.error as string | undefined;
        const exitCode = result.exitCode as number | undefined;
        const hasError = stderr || error || (exitCode !== undefined && exitCode !== 0);
        
        if (hasError) {
          // Record failure
          const errorContent = stderr || error || "Command failed";
          const learningContent = `Tool '${toolName}' failed: ${errorContent}`;
          
          await queryService.recordLearning(
            learningContent,
            'failure',
            JSON.stringify(result)
          );
          
          // Record metrics - failure learned
          metricsService.record('learning_failure', 1, { tool: toolName });
          
          console.log("ELF: Recorded failure learning");
        }
      } catch (error) {
        console.error("ELF: Error in event hook", error);
        // Don't throw - we don't want to break the system
      }
    },

    /**
     * ELF tool for agent use
     */
    tool: {
      elf: tool({
        description: `Manage and query the ELF (Emergent Learning Framework) memory system.

Modes:
- list-rules: List all golden rules
- list-heuristics: List all heuristics
- list-learnings: List recent learnings (optional limit parameter)
- add-rule: Add a new golden rule (requires content parameter)
- add-heuristic: Add a new heuristic (requires pattern and suggestion parameters)
- metrics: View performance metrics`,
        args: {
          mode: tool.schema.enum([
            "list-rules",
            "list-heuristics", 
            "list-learnings",
            "add-rule",
            "add-heuristic",
            "metrics"
          ]),
          content: tool.schema.string().optional(),
          pattern: tool.schema.string().optional(),
          suggestion: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
        },
        async execute(args: {
          mode: string;
          content?: string;
          pattern?: string;
          suggestion?: string;
          limit?: number;
        }) {
          // Ensure initialized
          if (!initialized) {
            await initialize();
          }

          const db = getDbClient();

          try {
            switch (args.mode) {
              case "list-rules": {
                const result = await db.execute(
                  "SELECT id, content, hit_count, created_at FROM golden_rules ORDER BY hit_count DESC"
                );
                return JSON.stringify({
                  success: true,
                  rules: result.rows.map(r => ({
                    id: r.id,
                    content: r.content,
                    hitCount: r.hit_count,
                    created: new Date(r.created_at as number).toISOString(),
                  })),
                  count: result.rows.length,
                });
              }

              case "list-heuristics": {
                const result = await db.execute(
                  "SELECT id, pattern, suggestion, created_at FROM heuristics ORDER BY created_at DESC"
                );
                return JSON.stringify({
                  success: true,
                  heuristics: result.rows.map(r => ({
                    id: r.id,
                    pattern: r.pattern,
                    suggestion: r.suggestion,
                    created: new Date(r.created_at as number).toISOString(),
                  })),
                  count: result.rows.length,
                });
              }

              case "list-learnings": {
                const limit = args.limit || 20;
                const result = await db.execute({
                  sql: "SELECT id, category, content, created_at FROM learnings ORDER BY created_at DESC LIMIT ?",
                  args: [limit],
                });
                return JSON.stringify({
                  success: true,
                  learnings: result.rows.map(r => ({
                    id: r.id,
                    category: r.category,
                    content: r.content,
                    created: new Date(r.created_at as number).toISOString(),
                  })),
                  count: result.rows.length,
                });
              }

              case "add-rule": {
                if (!args.content) {
                  return JSON.stringify({
                    success: false,
                    error: "content parameter is required for add-rule mode",
                  });
                }
                await queryService.addGoldenRule(args.content);
                return JSON.stringify({
                  success: true,
                  message: "Golden rule added successfully",
                  content: args.content,
                });
              }

              case "add-heuristic": {
                if (!args.pattern || !args.suggestion) {
                  return JSON.stringify({
                    success: false,
                    error: "pattern and suggestion parameters are required for add-heuristic mode",
                  });
                }
                
                const id = createHash('sha256')
                  .update(args.pattern + args.suggestion)
                  .digest('hex')
                  .slice(0, 16);
                
                await db.execute({
                  sql: `INSERT OR IGNORE INTO heuristics (id, pattern, suggestion, created_at)
                        VALUES (?, ?, ?, ?)`,
                  args: [id, args.pattern, args.suggestion, Date.now()]
                });
                
                return JSON.stringify({
                  success: true,
                  message: "Heuristic added successfully",
                  pattern: args.pattern,
                  suggestion: args.suggestion,
                });
              }

              case "metrics": {
                const result = await db.execute(
                  "SELECT type, COUNT(*) as count, AVG(value) as avg_value, MIN(value) as min_value, MAX(value) as max_value FROM metrics GROUP BY type ORDER BY type"
                );
                return JSON.stringify({
                  success: true,
                  metrics: result.rows.map(r => ({
                    type: r.type,
                    count: r.count,
                    average: r.avg_value,
                    min: r.min_value,
                    max: r.max_value,
                  })),
                });
              }

              default:
                return JSON.stringify({
                  success: false,
                  error: `Unknown mode: ${args.mode}`,
                });
            }
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
    },
  };
};
