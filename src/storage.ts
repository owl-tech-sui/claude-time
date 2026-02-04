/**
 * SQLiteストレージ
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Schedule, ExecutionLog, ExecutionStatus } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** デフォルトのデータベースパス */
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'claude-time.db');

export class Storage {
  private db: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    // データディレクトリが存在しない場合は作成
    const dataDir = dirname(dbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  /** テーブル初期化 */
  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        cron_expression TEXT NOT NULL,
        prompt TEXT NOT NULL,
        working_directory TEXT,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT,
        run_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS execution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        output TEXT,
        error TEXT,
        FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
      CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at);
      CREATE INDEX IF NOT EXISTS idx_logs_schedule_id ON execution_logs(schedule_id);
      CREATE INDEX IF NOT EXISTS idx_logs_started_at ON execution_logs(started_at);
    `);
  }

  /** スケジュール追加 */
  addSchedule(schedule: Schedule): void {
    const stmt = this.db.prepare(`
      INSERT INTO schedules (
        id, name, description, cron_expression, prompt, working_directory,
        enabled, created_at, updated_at, last_run_at, next_run_at, run_count, error_count
      ) VALUES (
        @id, @name, @description, @cron_expression, @prompt, @working_directory,
        @enabled, @created_at, @updated_at, @last_run_at, @next_run_at, @run_count, @error_count
      )
    `);
    stmt.run({
      ...schedule,
      enabled: schedule.enabled ? 1 : 0,
    });
  }

  /** スケジュール取得（ID指定） */
  getSchedule(id: string): Schedule | null {
    const stmt = this.db.prepare('SELECT * FROM schedules WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToSchedule(row);
  }

  /** スケジュール取得（名前指定） */
  getScheduleByName(name: string): Schedule | null {
    const stmt = this.db.prepare('SELECT * FROM schedules WHERE name = ?');
    const row = stmt.get(name) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToSchedule(row);
  }

  /** 全スケジュール取得 */
  getAllSchedules(): Schedule[] {
    const stmt = this.db.prepare('SELECT * FROM schedules ORDER BY created_at DESC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(row => this.rowToSchedule(row));
  }

  /** 有効なスケジュール取得 */
  getEnabledSchedules(): Schedule[] {
    const stmt = this.db.prepare('SELECT * FROM schedules WHERE enabled = 1 ORDER BY next_run_at ASC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(row => this.rowToSchedule(row));
  }

  /** スケジュール更新 */
  updateSchedule(id: string, updates: Partial<Schedule>): boolean {
    const schedule = this.getSchedule(id);
    if (!schedule) return false;

    const updated = {
      ...schedule,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const stmt = this.db.prepare(`
      UPDATE schedules SET
        name = @name,
        description = @description,
        cron_expression = @cron_expression,
        prompt = @prompt,
        working_directory = @working_directory,
        enabled = @enabled,
        updated_at = @updated_at,
        last_run_at = @last_run_at,
        next_run_at = @next_run_at,
        run_count = @run_count,
        error_count = @error_count
      WHERE id = @id
    `);
    stmt.run({
      ...updated,
      enabled: updated.enabled ? 1 : 0,
    });
    return true;
  }

  /** スケジュール削除 */
  deleteSchedule(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM schedules WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /** 実行ログ追加 */
  addExecutionLog(log: Omit<ExecutionLog, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO execution_logs (schedule_id, started_at, completed_at, status, output, error)
      VALUES (@schedule_id, @started_at, @completed_at, @status, @output, @error)
    `);
    const result = stmt.run(log);
    return Number(result.lastInsertRowid);
  }

  /** 実行ログ更新 */
  updateExecutionLog(id: number, updates: Partial<ExecutionLog>): void {
    const sets: string[] = [];
    const values: Record<string, unknown> = { id };

    if (updates.completed_at !== undefined) {
      sets.push('completed_at = @completed_at');
      values.completed_at = updates.completed_at;
    }
    if (updates.status !== undefined) {
      sets.push('status = @status');
      values.status = updates.status;
    }
    if (updates.output !== undefined) {
      sets.push('output = @output');
      values.output = updates.output;
    }
    if (updates.error !== undefined) {
      sets.push('error = @error');
      values.error = updates.error;
    }

    if (sets.length === 0) return;

    const stmt = this.db.prepare(`UPDATE execution_logs SET ${sets.join(', ')} WHERE id = @id`);
    stmt.run(values);
  }

  /** 実行ログ取得 */
  getExecutionLogs(scheduleId?: string, limit: number = 10): ExecutionLog[] {
    let query = 'SELECT * FROM execution_logs';
    const params: unknown[] = [];

    if (scheduleId) {
      query += ' WHERE schedule_id = ?';
      params.push(scheduleId);
    }

    query += ' ORDER BY started_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map(row => ({
      id: row.id as number,
      schedule_id: row.schedule_id as string,
      started_at: row.started_at as string,
      completed_at: row.completed_at as string | null,
      status: row.status as ExecutionStatus,
      output: row.output as string | null,
      error: row.error as string | null,
    }));
  }

  /** 実行回数をインクリメント */
  incrementRunCount(id: string, success: boolean): void {
    if (success) {
      const stmt = this.db.prepare(`
        UPDATE schedules SET
          run_count = run_count + 1,
          last_run_at = @last_run_at,
          updated_at = @updated_at
        WHERE id = @id
      `);
      stmt.run({
        id,
        last_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } else {
      const stmt = this.db.prepare(`
        UPDATE schedules SET
          error_count = error_count + 1,
          last_run_at = @last_run_at,
          updated_at = @updated_at
        WHERE id = @id
      `);
      stmt.run({
        id,
        last_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  /** 次回実行時刻を更新 */
  updateNextRunAt(id: string, nextRunAt: string | null): void {
    const stmt = this.db.prepare(`
      UPDATE schedules SET next_run_at = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(nextRunAt, new Date().toISOString(), id);
  }

  /** DBを閉じる */
  close(): void {
    this.db.close();
  }

  /** 行をScheduleに変換 */
  private rowToSchedule(row: Record<string, unknown>): Schedule {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | null,
      cron_expression: row.cron_expression as string,
      prompt: row.prompt as string,
      working_directory: row.working_directory as string | null,
      enabled: row.enabled === 1,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      last_run_at: row.last_run_at as string | null,
      next_run_at: row.next_run_at as string | null,
      run_count: row.run_count as number,
      error_count: row.error_count as number,
    };
  }
}
