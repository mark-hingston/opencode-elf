import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

// Storage configuration
export const GLOBAL_ELF_DIR = join(homedir(), ".opencode", "elf");
export const GLOBAL_DB_PATH = join(GLOBAL_ELF_DIR, "memory.db");
export const PROJECT_ELF_SUBDIR = ".opencode/elf";
export const PROJECT_DB_NAME = "memory.db";

// Hybrid storage configuration
export const ENABLE_HYBRID_STORAGE = true; // Set to false to use global-only

// Embedding model configuration
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384; // Dimension for all-MiniLM-L6-v2

// Query configuration
export const MAX_GOLDEN_RULES = 5;
export const MAX_RELEVANT_LEARNINGS = 10;
export const SIMILARITY_THRESHOLD = 0.7; // Minimum cosine similarity for relevance

/**
 * Find the project root by traversing up from the given directory
 * looking for common project markers (.git, package.json, etc.)
 */
export function findProjectRoot(startDir: string): string | null {
  let currentDir = startDir;
  const root = "/";
  
  while (currentDir !== root) {
    // Check for common project markers
    if (
      existsSync(join(currentDir, ".git")) ||
      existsSync(join(currentDir, ".opencode"))
    ) {
      return currentDir;
    }
    
    // Move up one directory
    const parentDir = join(currentDir, "..");
    if (parentDir === currentDir) {
      break; // Reached root
    }
    currentDir = parentDir;
  }
  
  return null;
}

/**
 * Get the project database path if a project root is found
 */
export function getProjectDbPath(workingDirectory: string): string | null {
  if (!ENABLE_HYBRID_STORAGE) {
    return null;
  }
  
  const projectRoot = findProjectRoot(workingDirectory);
  if (!projectRoot) {
    return null;
  }
  
  return join(projectRoot, PROJECT_ELF_SUBDIR, PROJECT_DB_NAME);
}

/**
 * Get all active database paths (global + project if available)
 */
export function getDbPaths(workingDirectory: string): { global: string; project: string | null } {
  return {
    global: GLOBAL_DB_PATH,
    project: getProjectDbPath(workingDirectory),
  };
}

// Backwards compatibility
export const ELF_DIR = GLOBAL_ELF_DIR;
export const DB_PATH = GLOBAL_DB_PATH;
