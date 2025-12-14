export type Embedding = number[];

export interface GoldenRule {
  id: string;
  content: string;
  embedding: Embedding;
  created_at: number;
  hit_count: number;
}

export interface Learning {
  id: string;
  content: string; // "Tried X, failed because Y" or "X worked for Y"
  category: 'success' | 'failure';
  embedding: Embedding;
  created_at: number;
  context_hash: string; // Hash of the tool output/error for deduplication
}

export interface Heuristic {
  id: string;
  pattern: string; // Regex or keyword pattern
  suggestion: string;
  created_at: number;
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
