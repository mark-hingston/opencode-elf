import type { Client } from "@libsql/client";
import {
  RULE_EXPIRATION_DAYS,
  RULE_MIN_HITS_TO_KEEP,
  LEARNING_EXPIRATION_DAYS,
  HEURISTIC_EXPIRATION_DAYS,
} from "../config.js";

export interface CleanupStats {
  rulesDeleted: number;
  learningsDeleted: number;
  heuristicsDeleted: number;
}

/**
 * Clean up expired rules, learnings, and heuristics from a database
 */
export async function cleanupExpiredData(db: Client): Promise<CleanupStats> {
  const now = Date.now();
  const stats: CleanupStats = {
    rulesDeleted: 0,
    learningsDeleted: 0,
    heuristicsDeleted: 0,
  };

  // Delete old unused rules (0 hits and older than RULE_EXPIRATION_DAYS)
  const ruleExpirationTime = now - (RULE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
  const rulesResult = await db.execute({
    sql: "DELETE FROM golden_rules WHERE hit_count < ? AND created_at < ?",
    args: [RULE_MIN_HITS_TO_KEEP, ruleExpirationTime],
  });
  stats.rulesDeleted = rulesResult.rowsAffected;

  // Delete old learnings
  const learningExpirationTime = now - (LEARNING_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
  const learningsResult = await db.execute({
    sql: "DELETE FROM learnings WHERE created_at < ?",
    args: [learningExpirationTime],
  });
  stats.learningsDeleted = learningsResult.rowsAffected;

  // Delete old heuristics
  const heuristicExpirationTime = now - (HEURISTIC_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
  const heuristicsResult = await db.execute({
    sql: "DELETE FROM heuristics WHERE created_at < ?",
    args: [heuristicExpirationTime],
  });
  stats.heuristicsDeleted = heuristicsResult.rowsAffected;

  return stats;
}

/**
 * Get statistics about data that would be deleted (dry run)
 */
export async function getCleanupPreview(db: Client): Promise<CleanupStats> {
  const now = Date.now();
  const stats: CleanupStats = {
    rulesDeleted: 0,
    learningsDeleted: 0,
    heuristicsDeleted: 0,
  };

  // Count old unused rules
  const ruleExpirationTime = now - (RULE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
  const rulesResult = await db.execute({
    sql: "SELECT COUNT(*) as count FROM golden_rules WHERE hit_count < ? AND created_at < ?",
    args: [RULE_MIN_HITS_TO_KEEP, ruleExpirationTime],
  });
  stats.rulesDeleted = rulesResult.rows[0].count as number;

  // Count old learnings
  const learningExpirationTime = now - (LEARNING_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
  const learningsResult = await db.execute({
    sql: "SELECT COUNT(*) as count FROM learnings WHERE created_at < ?",
    args: [learningExpirationTime],
  });
  stats.learningsDeleted = learningsResult.rows[0].count as number;

  // Count old heuristics
  const heuristicExpirationTime = now - (HEURISTIC_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
  const heuristicsResult = await db.execute({
    sql: "SELECT COUNT(*) as count FROM heuristics WHERE created_at < ?",
    args: [heuristicExpirationTime],
  });
  stats.heuristicsDeleted = heuristicsResult.rows[0].count as number;

  return stats;
}
