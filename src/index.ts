import { initDatabase, isDatabaseEmpty, seedGoldenRules, seedHeuristics, getDbClient, backfillFTS } from "./db/client.js";
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
  // Create query service with working directory
  const queryService = new QueryService(directory);

  // Track initialization state
  let initError: Error | null = null;

  // Track the most recently injected learning IDs to provide feedback
  let lastInjectedLearningIds: string[] = [];

  // 1. Start initialization in the background (do not await here)
  const initPromise = (async () => {
    console.log("ELF: Initializing in background...");
    const start = Date.now();

    try {
      // Get database paths
      const paths = getDbPaths(directory);

      // Initialize global database (always)
      await initDatabase(GLOBAL_DB_PATH);

      // Initialize project database if available
      if (paths.project) {
        await initDatabase(paths.project);
      }

      // Pre-load embedding model (This is the heavy part)
      await embeddingService.init();

      // Check if global database is empty and seed if needed
      const isEmpty = await isDatabaseEmpty(GLOBAL_DB_PATH);
      if (isEmpty) {
        console.log("ELF: First run detected - seeding default data...");
        await seedGoldenRules(queryService.addGoldenRule.bind(queryService));
        await seedHeuristics(GLOBAL_DB_PATH);
      }

      // Backfill FTS table for existing learnings (runs once after FTS is added)
      await backfillFTS(GLOBAL_DB_PATH);
      if (paths.project) {
        await backfillFTS(paths.project);
      }

      console.log(`ELF: Ready (took ${Date.now() - start}ms)`);
    } catch (error) {
      console.error("ELF: Background initialization failed", error);
      initError = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  })();

  // 2. Helper to ensure we are ready before processing hooks
  const ensureReady = async () => {
    if (initError) throw initError;
    await initPromise;
  };

  // 3. Return hooks immediately
  return {
    /**
     * Chat message hook - Inject ELF context into system prompt before LLM processing
     */
    "chat.message": async (input, output) => {
      const start = Date.now();

      try {
        // Wait for init to finish (only affects the very first message)
        await ensureReady();

        // Extract user text from message parts (TextParts have type "text" and a text field)
        const userMessage = output.parts
          .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
          .map(p => p.text)
          .join("\n")
          .trim();

        if (!userMessage) return;

        // Get relevant context from ELF
        const context = await queryService.getContext(userMessage);

        // Track which items were injected for feedback loop
        lastInjectedLearningIds = context.relevantLearnings.map(r => r.item.id);

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

          // Inject into the system prompt via output.message.system
          const currentSystem = output.message.system || "";
          output.message.system = currentSystem
            ? `${currentSystem}\n\n${elfMemory}`
            : elfMemory;

          // Record metrics
          const duration = Date.now() - start;
          metricsService.record('latency', duration);
          metricsService.record('injection', 1, {
            rules: context.goldenRules.length,
            learnings: context.relevantLearnings.length,
            heuristics: context.heuristics.length
          });
        }
      } catch (error) {
        // Fail open: If ELF fails, log it but don't break the user's chat
        console.error("ELF: Error in chat.message hook", error);
      }
    },

    /**
     * Event hook - Learn from tool executions
     */
    event: async ({ event }) => {
      try {
        // We can process events even if init is still running, 
        // but we need the DB ready to record learnings.
        await ensureReady();

        // @ts-ignore
        if (event.type !== "tool.execute.after") return;

        // Extract tool name, result, AND arguments
        const payload = event as unknown as {
          tool: string;
          result: Record<string, unknown>;
          args: Record<string, unknown>;
        };

        const toolName = payload.tool;
        const result = payload.result;
        const args = payload.args;

        if (!result || !toolName) return;

        // Detect failures (stderr, error codes, exceptions)
        const stderr = result.stderr as string | undefined;
        const error = result.error as string | undefined;
        const exitCode = result.exitCode as number | undefined;
        const hasError = stderr || error || (exitCode !== undefined && exitCode !== 0);

        if (hasError) {
          // Ignore user interruptions (SIGINT/130)
          if (exitCode === 130) return;

          // Ignore empty errors if there is no stderr
          if (!stderr && !error && exitCode === 0) return;

          // Get the command context
          // For bash/cmd tools, the command is usually in args.command or args.cmd
          // For other tools, we just stringify the args
          let commandContext = "";
          if (args) {
            if (typeof args.command === 'string') commandContext = args.command;
            else if (typeof args.cmd === 'string') commandContext = args.cmd;
            else commandContext = JSON.stringify(args);
          }

          // Truncate command if it's too long (to keep embeddings focused)
          if (commandContext.length > 100) {
            commandContext = `${commandContext.substring(0, 97)}...`;
          }

          // Construct a richer learning content
          const errorDetail = stderr || error || `Exit Code ${exitCode}`;

          // Format: "Tool 'bash' failed running 'npm install': stderr output..."
          const learningContent = `Tool '${toolName}' failed${commandContext ? ` running '${commandContext}'` : ''}: ${errorDetail}`;

          // Store full context for deduplication
          // We combine args + result so we distinguish between failing "npm install" vs "git status"
          const fullContext = JSON.stringify({ args, result });

          await queryService.recordLearning(
            learningContent,
            'failure',
            fullContext
          );

          metricsService.record('learning_failure', 1, { tool: toolName });
          console.log(`ELF: Recorded failure - ${learningContent.slice(0, 50)}...`);

          // Feedback loop: Penalize learnings that were present when failure happened
          if (lastInjectedLearningIds.length > 0) {
            for (const id of lastInjectedLearningIds) {
              await queryService.updateLearningUtility(id, -0.1);
            }
            console.log(`ELF: Penalized ${lastInjectedLearningIds.length} learnings due to failure`);
            lastInjectedLearningIds = []; // Clear after use
          }
        } else {
          // Success recording and utility boosting
          const isSuccess = !hasError && (exitCode === 0 || exitCode === undefined);

          // Heuristic for "complex" command
          let commandContext = "";
          if (args) {
            if (typeof args.command === 'string') commandContext = args.command;
            else if (typeof args.cmd === 'string') commandContext = args.cmd;
            else commandContext = JSON.stringify(args);
          }

          const isComplex = commandContext.length > 20 ||
            ['build', 'compile', 'deploy', 'test', 'git', 'docker', 'npm', 'yarn', 'pnpm', 'npx'].some(k =>
              commandContext.toLowerCase().includes(k)
            );

          if (isSuccess && isComplex) {
            const learningContent = `Tool '${toolName}' succeeded running '${commandContext.length > 100 ? commandContext.substring(0, 97) + '...' : commandContext}'`;
            const fullContext = JSON.stringify({ args, result });

            await queryService.recordLearning(
              learningContent,
              'success',
              fullContext
            );
            console.log(`ELF: Recorded success - ${learningContent.slice(0, 50)}...`);
          }

          // Feedback loop: Boost learnings that were present when success happened
          if (isSuccess && lastInjectedLearningIds.length > 0) {
            for (const id of lastInjectedLearningIds) {
              await queryService.updateLearningUtility(id, 0.1);
            }
            console.log(`ELF: Boosted ${lastInjectedLearningIds.length} learnings due to success`);
            lastInjectedLearningIds = []; // Clear after use
          }
        }
      } catch (error) {
        console.error("ELF: Error in event hook", error);
      }
    },

    /**
     * ELF tool for agent use
     */
    tool: {
      elf: tool({
        description: "Manage and query the ELF (Emergent Learning Framework) memory system. Use 'search' mode for hybrid semantic+keyword search across all learnings. If no mode is specified, returns help.",
        args: {
          mode: tool.schema.enum([
            "rules-list",
            "rules-add",
            "heuristics-list",
            "heuristics-add",
            "learnings-list",
            "metrics",
            "search",
            "help"
          ]).optional(),
          content: tool.schema.string().optional(),
          pattern: tool.schema.string().optional(),
          suggestion: tool.schema.string().optional(),
          query: tool.schema.string().optional(), // For search mode
          limit: tool.schema.number().optional(),
          scope: tool.schema.enum(["global", "project"]).optional(),
        },
        async execute(args: {
          mode?: string;
          content?: string;
          pattern?: string;
          suggestion?: string;
          query?: string;
          limit?: number;
          scope?: "global" | "project";
        }) {
          // Tool execution MUST wait for initialization
          await ensureReady();

          const paths = getDbPaths(directory);
          // Normalize mode: handle spaces (slash command args) vs hyphens (internal enum)
          // If the LLM passes "rules list", we want to map it to "rules-list" logic if we keep hyphens,
          // OR we can just use hyphens in the enum and expect the LLM to map.
          // Given the request is "/elf rules list", the LLM will see "rules list" as arguments.
          // Wait, if users type `/elf rules list`, the arguments to the tool will likely be parsed by the LLM.
          // It's safer to provide "rules-list" in the enum but explain "rules list" in description.
          // ACTUALLY, let's just use hyphens "rules-list" in the schema, but tell the user "rules list" works.
          // The LLM is smart enough to map "rules list" to "rules-list" enum if the description says commands: "rules list".
          // Let's stick to hyphens "rules-list" for the enum values to avoid whitespace issues in some tool parsers,
          // but change the semantic meaning to be Noun-Verb.

          let mode = args.mode || "help";

          // Helper to normalize "rules list" -> "rules-list" if the LLM passes it with space
          if (mode.includes(" ")) {
            mode = mode.replace(" ", "-");
          }

          try {
            switch (mode) {
              case "help": {
                return JSON.stringify({
                  success: true,
                  message: "ELF (Emergent Learning Framework) Usage Guide",
                  commands: [
                    { command: "rules list", description: "List golden rules" },
                    { command: "heuristics list", description: "List heuristics" },
                    { command: "learnings list", description: "List recent learnings" },
                    { command: "rules add", description: "Add a golden rule", args: ["content"] },
                    { command: "heuristics add", description: "Add a heuristic", args: ["pattern", "suggestion"] },
                    { command: "metrics", description: "View performance metrics" },
                    { command: "search", description: "Search learnings", args: ["query"] }
                  ]
                });
              }

              case "rules-list": {
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

              case "heuristics-list": {
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

              case "learnings-list": {
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

              case "rules-add": {
                if (!args.content) {
                  return JSON.stringify({
                    success: false,
                    error: "content parameter is required for rules-add mode",
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

              case "heuristics-add": {
                if (!args.pattern || !args.suggestion) {
                  return JSON.stringify({
                    success: false,
                    error: "pattern and suggestion parameters are required for heuristics-add mode",
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

              case "search": {
                if (!args.query) {
                  return JSON.stringify({
                    success: false,
                    error: "query parameter is required for search mode",
                  });
                }

                const results = await queryService.searchHybrid(args.query);
                const limit = args.limit || 10;

                return JSON.stringify({
                  success: true,
                  query: args.query,
                  count: results.length,
                  results: results.slice(0, limit).map(r => ({
                    id: r.item.id,
                    content: r.item.content,
                    category: r.item.category,
                    score: Number.parseFloat(r.score.toFixed(3)),
                    matchType: r.item.matchType || 'semantic',
                    scope: r.item.scope || 'global',
                    created: new Date(r.item.created_at).toISOString(),
                  })),
                });
              }

              default:
                return JSON.stringify({
                  success: false,
                  error: `Unknown mode: ${mode}`,
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

// NOTE: Do NOT export as default - OpenCode's plugin loader calls ALL exports
// as functions, which would cause double initialization.
