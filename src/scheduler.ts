/**
 * スケジューラーエンジン
 * node-cronを使ってスケジュールされたタスクを実行する
 */

import cron from 'node-cron';
import { Storage } from './storage.js';
import { executeSchedule } from './executor.js';
import { getNextRunTime } from './parser.js';
import { getTimezone } from './config.js';
import { notifySuccess, notifyFailure } from './notifier.js';
import type { Schedule } from './types.js';

/** DB変更検知のポーリング間隔（ミリ秒） */
const POLL_INTERVAL_MS = 30_000; // 30秒

export class Scheduler {
  private storage: Storage;
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private running: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastChecksum: string = '';

  constructor(storage: Storage) {
    this.storage = storage;
  }

  /** スケジューラーを開始 */
  start(): void {
    if (this.running) return;
    this.running = true;

    // 既存のスケジュールを読み込み
    const schedules = this.storage.getEnabledSchedules();
    for (const schedule of schedules) {
      this.scheduleJob(schedule);
    }

    // チェックサムを記録
    this.lastChecksum = this.storage.getScheduleChecksum();

    // DB変更検知ポーリングを開始
    this.startPolling();

    console.log(`[Scheduler] Started with ${schedules.length} schedule(s)`);
  }

  /** スケジューラーを停止 */
  stop(): void {
    if (!this.running) return;

    // ポーリングを停止
    this.stopPolling();

    for (const [id, job] of this.jobs) {
      job.stop();
      console.log(`[Scheduler] Stopped job: ${id}`);
    }
    this.jobs.clear();
    this.running = false;

    console.log('[Scheduler] Stopped');
  }

  /** ジョブをスケジュール */
  scheduleJob(schedule: Schedule): boolean {
    if (this.jobs.has(schedule.id)) {
      // 既存のジョブを停止
      this.jobs.get(schedule.id)?.stop();
    }

    // cron式をバリデート
    if (!cron.validate(schedule.cron_expression)) {
      console.error(`[Scheduler] Invalid cron expression: ${schedule.cron_expression}`);
      return false;
    }

    // ジョブを作成
    const job = cron.schedule(schedule.cron_expression, async () => {
      await this.runJob(schedule.id);
    }, {
      scheduled: true,
      timezone: getTimezone(),
    });

    this.jobs.set(schedule.id, job);

    // 次回実行時刻を更新
    const nextRun = getNextRunTime(schedule.cron_expression);
    if (nextRun) {
      this.storage.updateNextRunAt(schedule.id, nextRun.toISOString());
    }

    console.log(`[Scheduler] Scheduled job: ${schedule.name} (${schedule.cron_expression})`);
    return true;
  }

  /** ジョブを削除 */
  removeJob(scheduleId: string): void {
    const job = this.jobs.get(scheduleId);
    if (job) {
      job.stop();
      this.jobs.delete(scheduleId);
      console.log(`[Scheduler] Removed job: ${scheduleId}`);
    }
  }

  /** ジョブを実行 */
  async runJob(scheduleId: string): Promise<void> {
    const schedule = this.storage.getSchedule(scheduleId);
    if (!schedule) {
      console.error(`[Scheduler] Schedule not found: ${scheduleId}`);
      return;
    }

    if (!schedule.enabled) {
      console.log(`[Scheduler] Schedule disabled, skipping: ${schedule.name}`);
      return;
    }

    console.log(`[Scheduler] Running job: ${schedule.name}`);

    // 実行ログを作成
    const logId = this.storage.addExecutionLog({
      schedule_id: scheduleId,
      started_at: new Date().toISOString(),
      completed_at: null,
      status: 'running',
      output: null,
      error: null,
    });

    try {
      // Claude実行
      const result = await executeSchedule(schedule);

      // ログを更新
      this.storage.updateExecutionLog(logId, {
        completed_at: new Date().toISOString(),
        status: result.success ? 'success' : 'failed',
        output: result.output,
        error: result.error || null,
      });

      // 実行回数を更新
      this.storage.incrementRunCount(scheduleId, result.success);

      // 次回実行時刻を更新
      const nextRun = getNextRunTime(schedule.cron_expression);
      if (nextRun) {
        this.storage.updateNextRunAt(scheduleId, nextRun.toISOString());
      }

      if (result.success) {
        console.log(`[Scheduler] Job completed: ${schedule.name}`);
        await notifySuccess(schedule.name);
      } else {
        console.error(`[Scheduler] Job failed: ${schedule.name} - ${result.error}`);
        await notifyFailure(schedule.name, result.error);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // ログを更新
      this.storage.updateExecutionLog(logId, {
        completed_at: new Date().toISOString(),
        status: 'failed',
        error: errorMessage,
      });

      // エラーカウントを更新
      this.storage.incrementRunCount(scheduleId, false);

      console.error(`[Scheduler] Job error: ${schedule.name} - ${errorMessage}`);
      await notifyFailure(schedule.name, errorMessage);
    }
  }

  /** スケジュールをリロード */
  reload(): void {
    console.log('[Scheduler] Reloading schedules...');

    // 全ジョブを停止
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();

    // 再読み込み
    const schedules = this.storage.getEnabledSchedules();
    for (const schedule of schedules) {
      this.scheduleJob(schedule);
    }

    // チェックサムを更新
    this.lastChecksum = this.storage.getScheduleChecksum();

    console.log(`[Scheduler] Reloaded ${schedules.length} schedule(s)`);
  }

  /** 実行中かどうか */
  isRunning(): boolean {
    return this.running;
  }

  /** スケジュール数 */
  getJobCount(): number {
    return this.jobs.size;
  }

  /** DB変更検知ポーリングを開始 */
  private startPolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(() => {
      this.checkForChanges();
    }, POLL_INTERVAL_MS);

    console.log(`[Scheduler] Started DB change detection (every ${POLL_INTERVAL_MS / 1000}s)`);
  }

  /** DB変更検知ポーリングを停止 */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[Scheduler] Stopped DB change detection');
    }
  }

  /** DB変更をチェックしてリロード */
  private checkForChanges(): void {
    try {
      const currentChecksum = this.storage.getScheduleChecksum();
      if (currentChecksum !== this.lastChecksum) {
        console.log('[Scheduler] Schedule changes detected, reloading...');
        this.reload();
      }
    } catch (error) {
      console.error('[Scheduler] Error checking for changes:', error);
    }
  }
}
