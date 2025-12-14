import { initDatabase } from "./db/client";
import { embeddingService } from "./services/embeddings";
import { queryService } from "./services/query";
import { metricsService } from "./services/metrics";

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
    
    initialized = true;
    console.log("ELF: Plugin ready");
  } catch (error) {
    console.error("ELF: Initialization failed", error);
    throw error;
  }
}

/**
 * Chat params hook - Inject ELF context before the LLM processes the message
 */
export async function chatParams(params: Record<string, unknown>) {
  const start = Date.now(); // Start timer for metrics
  
  try {
    await initialize();
    
    const input = params.input as Record<string, unknown> | undefined;
    const message = input?.message as Record<string, unknown> | undefined;
    const userMessage = message?.text as string | undefined;
    
    if (!userMessage) return params;
    
    // Get relevant context from ELF
    const context = await queryService.getContext(userMessage);
    
    // Track which golden rules we're using
    if (context.goldenRules.length > 0) {
      const ruleIds = context.goldenRules.map(r => r.id);
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
    
    return params;
  } catch (error) {
    console.error("ELF: Error in chatParams hook", error);
    return params; // Don't break the chat if ELF fails
  }
}

/**
 * Event hook - Learn from tool executions
 */
export async function event(eventData: Record<string, unknown>) {
  try {
    await initialize();
    
    // Only process tool result events
    if (eventData.type !== "tool.result") return;
    
    const tool = eventData.tool as string | undefined;
    const result = eventData.result as Record<string, unknown> | undefined;
    
    // Skip if no result or tool name
    if (!result || !tool) return;
    
    // Detect failures (stderr, error codes, exceptions)
    const stderr = result.stderr as string | undefined;
    const error = result.error as string | undefined;
    const exitCode = result.exitCode as number | undefined;
    const hasError = stderr || error || (exitCode !== undefined && exitCode !== 0);
    
    if (hasError) {
      // Record failure
      const errorContent = stderr || error || "Command failed";
      const learningContent = `Tool '${tool}' failed: ${errorContent}`;
      
      await queryService.recordLearning(
        learningContent,
        'failure',
        JSON.stringify(result)
      );
      
      // Record metrics - failure learned
      metricsService.record('learning_failure', 1, { tool });
      
      console.log("ELF: Recorded failure learning");
    } else {
      // For now, we'll be conservative and only record explicit successes
      // In the future, you could add heuristics to detect success patterns
      // or allow users to manually mark successes
    }
  } catch (error) {
    console.error("ELF: Error in event hook", error);
    // Don't throw - we don't want to break the system
  }
}

// Export the hooks
export default {
  chatParams,
  event,
};
