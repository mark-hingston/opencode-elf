import { initDatabase, isDatabaseEmpty, seedGoldenRules, seedHeuristics, getDbClient } from "./db/client.js";
import { embeddingService } from "./services/embeddings.js";
import { QueryService } from "./services/query.js";
import { metricsService } from "./services/metrics.js";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { createHash } from "node:crypto";
import { getDbPaths, GLOBAL_DB_PATH } from "./config.js";

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
  
  // Create query service with working directory
  const queryService = new QueryService(directory);
  
  async function initialize() {
    if (initialized) return;
    
    console.log("ELF: Initializing plugin...");
    
    try {
      // Get database paths
      const paths = getDbPaths(directory);
      
      // Initialize global database (always)
      await initDatabase(GLOBAL_DB_PATH);
      console.log("ELF: Global database initialized");
      
      // Initialize project database if available
      if (paths.project) {
        await initDatabase(paths.project);
        console.log(`ELF: Project database initialized at ${paths.project}`);
      }
      
      // Pre-load embedding model
      await embeddingService.init();
      console.log("ELF: Embedding model loaded");
      
      // Check if global database is empty and seed if needed
      const isEmpty = await isDatabaseEmpty(GLOBAL_DB_PATH);
      if (isEmpty) {
        console.log("ELF: First run detected - seeding default data...");
        
        // Seed default golden rules and heuristics (global only)
        await seedGoldenRules(queryService.addGoldenRule.bind(queryService));
        await seedHeuristics(GLOBAL_DB_PATH);
        
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
- list-rules: List all golden rules (optional scope parameter)
- list-heuristics: List all heuristics (optional scope parameter)
- list-learnings: List recent learnings (optional limit and scope parameters)
- add-rule: Add a new golden rule (requires content parameter, optional scope)
- add-heuristic: Add a new heuristic (requires pattern and suggestion parameters, optional scope)
- metrics: View performance metrics

Scope can be "global" or "project". Defaults to "global" for add operations and "all" for list operations.`,
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
          scope: tool.schema.enum(["global", "project"]).optional(),
        },
        async execute(args: {
          mode: string;
          content?: string;
          pattern?: string;
          suggestion?: string;
          limit?: number;
          scope?: "global" | "project";
        }) {
          // Ensure initialized
          if (!initialized) {
            await initialize();
          }

          const paths = getDbPaths(directory);

          try {
            switch (args.mode) {
              case "list-rules": {
                const scope = args.scope;
                const clients = scope === "global" 
                  ? [getDbClient(GLOBAL_DB_PATH)]
                  : scope === "project" && paths.project
                    ? [getDbClient(paths.project)]
                    : [getDbClient(GLOBAL_DB_PATH), ...(paths.project ? [getDbClient(paths.project)] : [])];
                
                const allRules: Array<{ id: string; content: string; hitCount: number; created: string; scope: string }> = [];
                
                for (let i = 0; i < clients.length; i++) {
                  const db = clients[i];
                  const dbScope = (scope || (i === 0 ? "global" : "project")) as string;
                  
                  const result = await db.execute(
                    "SELECT id, content, hit_count, created_at FROM golden_rules ORDER BY hit_count DESC"
                  );
                  
                  allRules.push(...result.rows.map(r => ({
                    id: r.id as string,
                    content: r.content as string,
                    hitCount: r.hit_count as number,
                    created: new Date(r.created_at as number).toISOString(),
                    scope: dbScope,
                  })));
                }
                
                return JSON.stringify({
                  success: true,
                  rules: allRules,
                  count: allRules.length,
                });
              }

              case "list-heuristics": {
                const scope = args.scope;
                const clients = scope === "global" 
                  ? [getDbClient(GLOBAL_DB_PATH)]
                  : scope === "project" && paths.project
                    ? [getDbClient(paths.project)]
                    : [getDbClient(GLOBAL_DB_PATH), ...(paths.project ? [getDbClient(paths.project)] : [])];
                
                const allHeuristics: Array<{ id: string; pattern: string; suggestion: string; created: string; scope: string }> = [];
                
                for (let i = 0; i < clients.length; i++) {
                  const db = clients[i];
                  const dbScope = (scope || (i === 0 ? "global" : "project")) as string;
                  
                  const result = await db.execute(
                    "SELECT id, pattern, suggestion, created_at FROM heuristics ORDER BY created_at DESC"
                  );
                  
                  allHeuristics.push(...result.rows.map(r => ({
                    id: r.id as string,
                    pattern: r.pattern as string,
                    suggestion: r.suggestion as string,
                    created: new Date(r.created_at as number).toISOString(),
                    scope: dbScope,
                  })));
                }
                
                return JSON.stringify({
                  success: true,
                  heuristics: allHeuristics,
                  count: allHeuristics.length,
                });
              }

              case "list-learnings": {
                const limit = args.limit || 20;
                const scope = args.scope;
                const clients = scope === "global" 
                  ? [getDbClient(GLOBAL_DB_PATH)]
                  : scope === "project" && paths.project
                    ? [getDbClient(paths.project)]
                    : [getDbClient(GLOBAL_DB_PATH), ...(paths.project ? [getDbClient(paths.project)] : [])];
                
                const allLearnings: Array<{ id: string; category: string; content: string; created: string; scope: string }> = [];
                
                for (let i = 0; i < clients.length; i++) {
                  const db = clients[i];
                  const dbScope = (scope || (i === 0 ? "global" : "project")) as string;
                  
                  const result = await db.execute({
                    sql: "SELECT id, category, content, created_at FROM learnings ORDER BY created_at DESC LIMIT ?",
                    args: [limit],
                  });
                  
                  allLearnings.push(...result.rows.map(r => ({
                    id: r.id as string,
                    category: r.category as string,
                    content: r.content as string,
                    created: new Date(r.created_at as number).toISOString(),
                    scope: dbScope,
                  })));
                }
                
                // Sort all learnings by creation date
                allLearnings.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
                
                return JSON.stringify({
                  success: true,
                  learnings: allLearnings.slice(0, limit),
                  count: allLearnings.length,
                });
              }

              case "add-rule": {
                if (!args.content) {
                  return JSON.stringify({
                    success: false,
                    error: "content parameter is required for add-rule mode",
                  });
                }
                
                const scope = args.scope || "global";
                await queryService.addGoldenRule(args.content, scope);
                
                return JSON.stringify({
                  success: true,
                  message: `Golden rule added successfully to ${scope} scope`,
                  content: args.content,
                  scope,
                });
              }

              case "add-heuristic": {
                if (!args.pattern || !args.suggestion) {
                  return JSON.stringify({
                    success: false,
                    error: "pattern and suggestion parameters are required for add-heuristic mode",
                  });
                }
                
                const scope = args.scope || "global";
                const dbPath = scope === "project" && paths.project ? paths.project : GLOBAL_DB_PATH;
                const db = getDbClient(dbPath);
                
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
                  message: `Heuristic added successfully to ${scope} scope`,
                  pattern: args.pattern,
                  suggestion: args.suggestion,
                  scope,
                });
              }

              case "metrics": {
                const db = getDbClient(GLOBAL_DB_PATH);
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
