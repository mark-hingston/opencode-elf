# OpenCode ELF Plugin

**Emergent Learning Framework (ELF)** for OpenCode - Learn from past successes and failures to continuously improve your AI coding assistant.

## Overview

This plugin implements the Emergent Learning Framework (originally from [Spacehunterz/ELF](https://context7.com/spacehunterz/emergent-learning-framework_elf/llms.txt)) as an OpenCode plugin. It provides:

- **Golden Rules**: Constitutional principles that guide all actions
- **Learnings**: Automatic recording of tool execution failures and successes
- **Context Injection**: Relevant past experiences are injected into each conversation
- **Local-First**: Uses local SQLite storage and local embeddings (no API calls)

## Architecture

```
┌─────────────────────────────────────────────────┐
│              OpenCode ELF Plugin                │
├─────────────────────────────────────────────────┤
│                                                 │
│  Hooks:                                         │
│  ┌────────────────┐     ┌───────────────────┐  │
│  │  chat.params   │────▶│  Context Injection│  │
│  │  (pre-LLM)     │     │  - Golden Rules   │  │
│  │                │     │  - Past Learnings │  │
│  │                │     │  - Heuristics     │  │
│  └────────────────┘     └───────────────────┘  │
│                                                 │
│  ┌────────────────┐     ┌───────────────────┐  │
│  │  event         │────▶│  Learning Loop    │  │
│  │  (post-tool)   │     │  - Record failures│  │
│  │                │     │  - Track patterns │  │
│  └────────────────┘     └───────────────────┘  │
│                                                 │
│  Storage:                                       │
│  ┌────────────────────────────────────────────┐│
│  │  libsql (SQLite)                           ││
│  │  ~/.opencode/elf/memory.db                 ││
│  └────────────────────────────────────────────┘│
│                                                 │
│  Embeddings:                                    │
│  ┌────────────────────────────────────────────┐│
│  │  @xenova/transformers                      ││
│  │  Model: Xenova/all-MiniLM-L6-v2            ││
│  └────────────────────────────────────────────┘│
│                                                 │
└─────────────────────────────────────────────────┘
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/mark-hingston/opencode-elf.git
cd opencode-elf
```

2. Install dependencies:
```bash
npm install
```

3. Build the plugin:
```bash
npm run build
```

4. Link the plugin to OpenCode:
```bash
# In the OpenCode config directory
ln -s /path/to/opencode-elf ~/.opencode/plugins/opencode-elf
```

5. Restart OpenCode to load the plugin.

## Usage

The plugin works automatically once installed. Here's what happens:

### Context Injection (Before each message)

When you send a message to OpenCode, ELF:
1. Generates an embedding for your message
2. Searches for relevant Golden Rules and past Learnings
3. Injects this context into the system prompt

Example injection:
```
[ELF MEMORY]

Golden Rules:
- Always validate user inputs before processing
- Use TypeScript strict mode for type safety

Relevant Past Experiences:
✗ [85%] Tool 'bash' failed: command not found - npm
✓ [78%] Successfully used 'git' to commit changes with proper message

Applicable Heuristics:
- When working with npm, always check if node_modules exists
```

### Learning Loop (After each tool execution)

When a tool executes, ELF:
1. Monitors the result (stdout, stderr, exit codes)
2. Records failures automatically
3. Stores them with embeddings for future retrieval

## Configuration

Configuration is in `src/config.ts`:

```typescript
// Storage location
export const ELF_DIR = join(homedir(), ".opencode", "elf");

// Embedding model
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

// Query limits
export const MAX_GOLDEN_RULES = 5;
export const MAX_RELEVANT_LEARNINGS = 10;
export const SIMILARITY_THRESHOLD = 0.7;
```

## Managing Golden Rules

Golden Rules are constitutional principles that should always guide the AI's behavior. To add them:

```typescript
// Direct database access (for now)
import { queryService } from "./src/services/query";

await queryService.addGoldenRule(
  "Always validate inputs before processing"
);
```

Future versions will include a CLI or UI for managing these.

## Database Schema

The plugin uses SQLite with the following tables:

- `golden_rules`: Core principles (always included in context)
- `learnings`: Success/failure records with embeddings
- `heuristics`: Pattern-based suggestions

## Development

```bash
# Watch mode for development
npm run dev

# Build for production
npm run build
```

## Roadmap

- [ ] CLI commands for managing Golden Rules and Learnings
- [ ] Success detection (currently only failures are auto-recorded)
- [ ] Experiment tracking (hypothesis testing)
- [ ] Decision records (ADRs)
- [ ] Vector index optimization (avoid scanning all learnings)
- [ ] Export/import memory database
- [ ] Analytics dashboard

## Credits

Based on the [Emergent Learning Framework](https://context7.com/spacehunterz/emergent-learning-framework_elf/llms.txt) by **Spacehunterz**.

## License

MIT
