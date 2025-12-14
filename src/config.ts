import { join } from "node:path";
import { homedir } from "node:os";

// Configuration
export const ELF_DIR = join(homedir(), ".opencode", "elf");
export const DB_PATH = join(ELF_DIR, "memory.db");

// Embedding model configuration
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384; // Dimension for all-MiniLM-L6-v2

// Query configuration
export const MAX_GOLDEN_RULES = 5;
export const MAX_RELEVANT_LEARNINGS = 10;
export const SIMILARITY_THRESHOLD = 0.7; // Minimum cosine similarity for relevance
