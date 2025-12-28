export type Embedding = number[];
export type MemoryScope = "global" | "project";

export interface GoldenRule {
  id: string;
  content: string;
  embedding: Embedding;
  created_at: number;
  hit_count: number;
  scope?: MemoryScope; // Added for tracking where the rule came from
}

export interface Learning {
  id: string;
  content: string; // "Tried X, failed because Y" or "X worked for Y"
  category: 'success' | 'failure';
  embedding: Embedding;
  created_at: number;
  context_hash: string; // Hash of the tool output/error for deduplication
  utility_score?: number; // Default 1.0. Increment on success, decrement on failure.
  scope?: MemoryScope; // Added for tracking where the learning came from
  matchType?: 'semantic' | 'keyword' | 'hybrid'; // How this learning was found in search
}

export interface Heuristic {
  id: string;
  pattern: string; // Regex or keyword pattern
  suggestion: string;
  created_at: number;
  scope?: MemoryScope; // Added for tracking where the heuristic came from
}

export interface SearchResult<T> {
  item: T;
  score: number; // Similarity score
}

export interface ELFContext {
  goldenRules: GoldenRule[];
  relevantLearnings: SearchResult<Learning>[];
  heuristics: Heuristic[];
}
