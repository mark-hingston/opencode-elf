# OpenCode ELF Plugin

**Emergent Learning Framework (ELF)** for OpenCode - Learn from past successes and failures to continuously improve your AI coding assistant.

## Overview

This plugin implements the Emergent Learning Framework (originally from [Spacehunterz/ELF](https://context7.com/spacehunterz/emergent-learning-framework_elf/llms.txt)) as an OpenCode plugin. It provides:

- **Golden Rules**: Constitutional principles that guide all actions
- **Heuristics**: Pattern-based suggestions triggered by keywords/regex
- **Learnings**: Automatic recording of tool execution failures and successes
- **Context Injection**: Relevant past experiences are injected into each conversation
- **Local-First**: Uses local SQLite storage and local embeddings (no API calls)

## Installation

Add to your OpenCode config:

```jsonc
// opencode.jsonc
{
  "plugin": ["opencode-elf@latest"]
}
```

Using `@latest` ensures you always get the newest version automatically when OpenCode starts.

Restart OpenCode. The plugin will automatically load.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              OpenCode ELF Plugin                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Hooks:                                              │
│  ┌─────────────────┐      ┌────────────────────┐     │
│  │  chat.params    │─────▶│ Context Injection  │     │
│  │  (pre-LLM)      │      │ - Golden Rules     │     │
│  │                 │      │ - Past Learnings   │     │
│  │                 │      │ - Heuristics       │     │
│  └─────────────────┘      └────────────────────┘     │
│                                                      │
│  ┌─────────────────┐      ┌────────────────────┐     │
│  │  event          │─────▶│ Learning Loop      │     │
│  │  (post-tool)    │      │ - Record failures  │     │
│  │                 │      │ - Track patterns   │     │
│  └─────────────────┘      └────────────────────┘     │
│                                                      │
│  Storage:                                            │
│  ┌──────────────────────────────────────────────┐    │
│  │  libsql (SQLite)                             │    │
│  │  ~/.opencode/elf/memory.db                   │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  Embeddings:                                         │
│  ┌──────────────────────────────────────────────┐    │
│  │  @xenova/transformers                        │    │
│  │  Model: Xenova/all-MiniLM-L6-v2              │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## How It Works

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

## Quick Start

### 1. Installation & First Run

After installing the plugin, restart OpenCode. The plugin will automatically:
- Initialize the database
- Load the embedding model (~90MB download on first run)
- Seed 10 default golden rules
- Seed 10 default heuristics

You'll see output like:
```
ELF: Initializing plugin...
ELF: Database initialized
ELF: Embedding model loaded
ELF: First run detected - seeding default data...
ELF: Seeding default golden rules...
ELF: Added 10 default golden rules
ELF: Seeding default heuristics...
ELF: Added 10 default heuristics
ELF: Default data seeded successfully
ELF: Plugin ready
```

The plugin is now ready to use! No manual setup required.

### 2. Verify Installation (Optional)

If you're developing locally, you can run the simulation test to verify everything works:

```bash
npm run test:simulate
```

Expected output:
```
🤖 Starting ELF Simulation...

1️⃣  Seeding Golden Rule...
ELF: Loading embedding model...
ELF: Model loaded.

2️⃣  Simulating Chat Request...
✅ SUCCESS: Context injected Golden Rule into system prompt.

3️⃣  Simulating Tool Failure...
✅ Tool failure event processed.

4️⃣  Verifying Learning Retrieval...
✅ SUCCESS: Retrieved the learned failure from memory.

🎉 Simulation Complete.
```

### 3. Start Using OpenCode

The plugin now works automatically! Golden rules and learnings will be injected into conversations as context.

## Managing Data

The plugin automatically seeds default data on first run. You can manage this data using the CLI tools below (requires local development setup or plugin directory access).

### Golden Rules

Golden Rules are constitutional principles that should always guide the AI's behavior.

```bash
# Add a new rule
npm run rules:add "Always validate inputs before processing"

# List all rules
npm run rules:list

# Re-seed default rules (if you deleted them)
npm run rules:seed
```

### Heuristics

Heuristics are pattern-based suggestions triggered by regex matching.

```bash
# Add a new heuristic
npm run heuristics:add "npm install" "Check package.json exists first"

# List all heuristics
npm run heuristics:list

# Re-seed default heuristics (if you deleted them)
npm run heuristics:seed
```

### Learnings

View recorded successes and failures:

```bash
# View all learnings
npm run learnings:view

# View only failures
npm run learnings:view failure

# View only successes
npm run learnings:view success
```

### Performance Metrics

Track ELF's performance and usage:

```bash
npm run metrics:view
```

This shows:
- Average latency for context injection
- Total context injections
- Failures learned
- Recent activity

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

## Database Schema

The plugin uses SQLite with the following tables:

### golden_rules
- `id` (TEXT PK)
- `content` (TEXT)
- `embedding` (TEXT - JSON array)
- `created_at` (INTEGER - timestamp)
- `hit_count` (INTEGER - usage tracking)

### learnings
- `id` (TEXT PK)
- `content` (TEXT)
- `category` ('success' | 'failure')
- `embedding` (TEXT - JSON array)
- `created_at` (INTEGER)
- `context_hash` (TEXT - for deduplication)

### heuristics
- `id` (TEXT PK)
- `pattern` (TEXT - regex)
- `suggestion` (TEXT)
- `created_at` (INTEGER)

## Project Structure

```
opencode-elf/
├── package.json              # Dependencies & scripts
├── tsconfig.json             # TypeScript config
├── README.md                 # This file
├── LICENSE                   # MIT license
│
├── src/
│   ├── index.ts              # Plugin entry (hooks)
│   ├── config.ts             # Configuration
│   │
│   ├── types/
│   │   └── elf.ts            # TypeScript types
│   │
│   ├── db/
│   │   └── client.ts         # Database client & schema
│   │
│   └── services/
│       ├── embeddings.ts     # Vector embeddings
│       ├── metrics.ts        # Performance tracking
│       └── query.ts          # Context builder
│
├── scripts/
│   ├── manage-rules.js       # CLI: add/list rules
│   ├── manage-heuristics.js  # CLI: add/list heuristics
│   ├── view-learnings.js     # CLI: view learnings
│   ├── view-metrics.js       # CLI: view metrics
│   ├── seed-rules.js         # Seed default rules
│   └── seed-heuristics.js    # Seed default heuristics
│
└── tests/
    └── simulate.ts           # End-to-end simulation
```

## Development

### Building

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Watch mode for development
npm run dev
```

### Local Development Installation

For local development without publishing to npm:

```bash
# Clone and build
git clone https://github.com/mark-hingston/opencode-elf.git
cd opencode-elf
npm install
npm run build

# Add to your opencode.jsonc using local path
{
  "plugin": ["file:///absolute/path/to/opencode-elf"]
}
```

## Troubleshooting

### Plugin Not Loading
- Check OpenCode logs for errors
- Verify plugin is in your `opencode.jsonc` config
- Ensure `dist/` folder exists (run `npm run build`)
- Check for TypeScript compilation errors

### Embedding Model Download
First run will download the model (~90MB). This takes 1-2 minutes. Subsequent runs are instant.

### Database Location
Database is stored at: `~/.opencode/elf/memory.db`

To reset: `rm -rf ~/.opencode/elf/`

### Performance Issues
Expected performance (after model is loaded):

| Operation | Time |
|-----------|------|
| Add golden rule | ~50-100ms |
| Query context | ~200-500ms |
| Record learning | ~100-200ms |
| Embedding generation | ~50-150ms |

If performance is slower, check:
- Model is loaded (check logs)
- Database isn't locked
- Sufficient disk space for embeddings cache

## Roadmap

- [x] Core learning loop
- [x] Golden rules
- [x] Heuristics
- [x] CLI management tools
- [x] Performance metrics
- [x] Simulation testing
- [ ] Success detection (currently only failures are auto-recorded)
- [ ] Experiment tracking (hypothesis testing)
- [ ] Decision records (ADRs)
- [ ] Vector index optimization (avoid scanning all learnings)
- [ ] Export/import memory database
- [ ] Analytics dashboard
- [ ] Web UI for management

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm run test:simulate`
5. Build: `npm run build`
6. Commit your changes: `git commit -m 'Add my feature'`
7. Push to the branch: `git push origin feature/my-feature`
8. Submit a pull request

### Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Add JSDoc comments for public APIs
- Keep functions small and focused

## Credits

Based on the [Emergent Learning Framework](https://github.com/Spacehunterz/Emergent-Learning-Framework_ELF).

## License

MIT
