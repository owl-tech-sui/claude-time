/**
 * claude-time 型定義
 */

/** スケジュールの基本情報 */
export interface Schedule {
  id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  prompt: string;
  working_directory: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  error_count: number;
}

/** スケジュール作成時の入力 */
export interface ScheduleInput {
  name: string;
  schedule: string;  // 自然言語 or cron式
  prompt: string;
  working_directory?: string;
  description?: string;
}

/** 実行ログ */
export interface ExecutionLog {
  id: number;
  schedule_id: string;
  started_at: string;
  completed_at: string | null;
  status: ExecutionStatus;
  output: string | null;
  error: string | null;
}

/** 実行ステータス */
export type ExecutionStatus = 'running' | 'success' | 'failed';

/** スケジュール追加の結果 */
export interface ScheduleAddResult {
  id: string;
  name: string;
  cron_expression: string;
  next_run_at: string;
  message: string;
}

/** スケジュール一覧の結果 */
export interface ScheduleListResult {
  schedules: ScheduleListItem[];
}

/** スケジュール一覧の各項目 */
export interface ScheduleListItem {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  error_count: number;
}

/** 実行ログ取得の入力 */
export interface LogsInput {
  schedule_id?: string;
  limit?: number;
}

/** 実行ログ取得の結果 */
export interface LogsResult {
  logs: ExecutionLog[];
}

/** デーモンのステータス */
export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
  schedules_count: number;
  next_execution: string | null;
}

/** パーサーの結果 */
export interface ParseResult {
  success: boolean;
  cron_expression?: string;
  error?: string;
  human_readable?: string;
}
