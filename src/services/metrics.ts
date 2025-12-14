import { getDbClient } from "../db/client";
import { createHash } from "node:crypto";

export class MetricsService {
  /**
   * Record a metric
   * Fire-and-forget pattern - errors are logged but don't throw
   */
  async record(type: string, value: number, meta?: Record<string, unknown>): Promise<void> {
    const db = getDbClient();
    const id = createHash('sha256')
      .update(type + Date.now().toString() + Math.random().toString())
      .digest('hex')
      .slice(0, 16);

    // Fire and forget - don't await this in the main loop if possible
    db.execute({
      sql: "INSERT INTO metrics (id, type, value, meta, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, type, value, meta ? JSON.stringify(meta) : null, Date.now()]
    }).catch(err => console.error("ELF Metrics Error:", err));
  }

  /**
   * Get performance summary statistics
   */
  async getSummary(): Promise<{
    avgLatency: number;
    maxLatency: number;
    totalInjections: number;
    totalFailures: number;
  }> {
    const db = getDbClient();
    
    // Average and max latency
    const latency = await db.execute(
      "SELECT AVG(value) as avg_ms, MAX(value) as max_ms FROM metrics WHERE type = 'latency'"
    );
    
    // Total injections
    const injections = await db.execute(
      "SELECT COUNT(*) as count FROM metrics WHERE type = 'injection'"
    );
    
    // Total failures recorded
    const failures = await db.execute(
      "SELECT COUNT(*) as count FROM metrics WHERE type = 'learning_failure'"
    );

    return {
      avgLatency: (latency.rows[0]?.avg_ms as number) || 0,
      maxLatency: (latency.rows[0]?.max_ms as number) || 0,
      totalInjections: (injections.rows[0]?.count as number) || 0,
      totalFailures: (failures.rows[0]?.count as number) || 0
    };
  }

  /**
   * Get recent activity
   */
  async getRecentActivity(limit = 10): Promise<Array<{
    type: string;
    value: number;
    meta?: string;
    created_at: number;
  }>> {
    const db = getDbClient();
    
    const result = await db.execute({
      sql: "SELECT * FROM metrics ORDER BY created_at DESC LIMIT ?",
      args: [limit]
    });

    return result.rows.map(row => ({
      type: row.type as string,
      value: row.value as number,
      meta: row.meta as string | undefined,
      created_at: row.created_at as number
    }));
  }

  /**
   * Clear old metrics (for maintenance)
   */
  async clearOldMetrics(olderThanDays = 30): Promise<void> {
    const db = getDbClient();
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    await db.execute({
      sql: "DELETE FROM metrics WHERE created_at < ?",
      args: [cutoff]
    });
  }
}

export const metricsService = new MetricsService();
