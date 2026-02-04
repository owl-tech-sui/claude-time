/**
 * 新機能のテスト
 * - schedule_update
 * - schedule_cleanup
 * - dry_run
 * - 通知機能
 */

import { Storage } from '../src/storage';
import { sendNotification, notifySuccess, notifyFailure } from '../src/notifier';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// テスト用DBパス
const TEST_DB_PATH = join(__dirname, 'test-new-features.db');

describe('Storage - deleteOldLogs', () => {
  let storage: Storage;

  beforeEach(() => {
    // テストDBを削除
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    storage = new Storage(TEST_DB_PATH);
  });

  afterEach(() => {
    storage.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  it('should delete logs older than specified days', () => {
    // スケジュールを追加
    const scheduleId = 'test-schedule-1';
    storage.addSchedule({
      id: scheduleId,
      name: 'Test Schedule',
      description: null,
      cron_expression: '0 9 * * *',
      prompt: 'test prompt',
      working_directory: null,
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_run_at: null,
      next_run_at: null,
      run_count: 0,
      error_count: 0,
    });

    // 古いログを追加（40日前）
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 40);
    storage.addExecutionLog({
      schedule_id: scheduleId,
      started_at: oldDate.toISOString(),
      completed_at: oldDate.toISOString(),
      status: 'success',
      output: 'old log',
      error: null,
    });

    // 新しいログを追加（今日）
    storage.addExecutionLog({
      schedule_id: scheduleId,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'success',
      output: 'new log',
      error: null,
    });

    // 30日より古いログを削除
    const deletedCount = storage.deleteOldLogs(30);

    expect(deletedCount).toBe(1);

    // 残りのログを確認
    const logs = storage.getExecutionLogs(scheduleId, 10);
    expect(logs.length).toBe(1);
    expect(logs[0].output).toBe('new log');
  });

  it('should return 0 when no old logs exist', () => {
    const deletedCount = storage.deleteOldLogs(30);
    expect(deletedCount).toBe(0);
  });
});

describe('Storage - updateSchedule', () => {
  let storage: Storage;

  beforeEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    storage = new Storage(TEST_DB_PATH);
  });

  afterEach(() => {
    storage.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  it('should update schedule fields', () => {
    const scheduleId = 'test-schedule-2';
    storage.addSchedule({
      id: scheduleId,
      name: 'Original Name',
      description: null,
      cron_expression: '0 9 * * *',
      prompt: 'original prompt',
      working_directory: null,
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_run_at: null,
      next_run_at: null,
      run_count: 0,
      error_count: 0,
    });

    // 更新
    const result = storage.updateSchedule(scheduleId, {
      name: 'Updated Name',
      prompt: 'updated prompt',
      cron_expression: '0 10 * * *',
    });

    expect(result).toBe(true);

    // 確認
    const updated = storage.getSchedule(scheduleId);
    expect(updated?.name).toBe('Updated Name');
    expect(updated?.prompt).toBe('updated prompt');
    expect(updated?.cron_expression).toBe('0 10 * * *');
  });

  it('should return false for non-existent schedule', () => {
    const result = storage.updateSchedule('non-existent', { name: 'New Name' });
    expect(result).toBe(false);
  });
});

describe('Notifier', () => {
  it('should not throw when sending notification', async () => {
    // 通知を無効化してテスト
    process.env.CLAUDE_TIME_NOTIFY = 'false';

    await expect(sendNotification({
      title: 'Test',
      message: 'Test message',
    })).resolves.toBeUndefined();

    await expect(notifySuccess('Test Schedule')).resolves.toBeUndefined();
    await expect(notifyFailure('Test Schedule', 'Test error')).resolves.toBeUndefined();

    delete process.env.CLAUDE_TIME_NOTIFY;
  });

  it('should handle special characters in message', async () => {
    process.env.CLAUDE_TIME_NOTIFY = 'false';

    await expect(sendNotification({
      title: 'Test "quoted"',
      message: 'Message with "quotes" and \\ backslashes',
    })).resolves.toBeUndefined();

    delete process.env.CLAUDE_TIME_NOTIFY;
  });
});
