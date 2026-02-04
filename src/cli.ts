#!/usr/bin/env node
/**
 * claude-time CLI
 * デーモン管理とスケジュール確認用のCLI
 */

import { spawn } from 'child_process';
import { Storage } from './storage.js';
import {
  LOG_FILE,
  readPid,
  isProcessRunning,
  checkDaemonRunning,
} from './pid.js';
import { formatDateTime, getConfigInfo } from './config.js';

/** デーモン開始 */
function daemonStart(): void {
  const { running, pid: existingPid } = checkDaemonRunning();
  if (running) {
    console.log(`Daemon is already running (PID: ${existingPid})`);
    return;
  }

  console.log('Starting daemon...');

  const daemonPath = new URL('./daemon.js', import.meta.url).pathname;
  const child = spawn('node', [daemonPath, '--foreground'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  child.unref();

  // 少し待ってからPIDを確認
  setTimeout(() => {
    const pid = readPid();
    if (pid && isProcessRunning(pid)) {
      console.log(`✅ Daemon started (PID: ${pid})`);
    } else {
      console.error('❌ Failed to start daemon');
    }
  }, 1000);
}

/** デーモン停止 */
function daemonStop(): void {
  const { running, pid } = checkDaemonRunning();
  if (!running || !pid) {
    console.log('Daemon is not running.');
    return;
  }

  console.log(`Stopping daemon (PID: ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
    console.log('✅ Daemon stopped.');
  } catch (error) {
    console.error('❌ Failed to stop daemon:', error);
  }
}

/** デーモンステータス */
function daemonStatus(): void {
  const { running, pid } = checkDaemonRunning();

  if (!running) {
    console.log('❌ Daemon is not running.');
    return;
  }

  const storage = new Storage();
  const schedules = storage.getEnabledSchedules();
  storage.close();

  console.log(`✅ Daemon is running (PID: ${pid})`);
  console.log(`📅 Active schedules: ${schedules.length}`);

  if (schedules.length > 0) {
    console.log('\nSchedules:');
    for (const schedule of schedules) {
      const nextRun = schedule.next_run_at
        ? formatDateTime(schedule.next_run_at)
        : 'N/A';
      console.log(`  - ${schedule.name}`);
      console.log(`    Cron: ${schedule.cron_expression}`);
      console.log(`    Next: ${nextRun}`);
    }
  }
}

/** スケジュール一覧 */
function listSchedules(): void {
  const storage = new Storage();
  const schedules = storage.getAllSchedules();
  storage.close();

  if (schedules.length === 0) {
    console.log('No schedules found.');
    return;
  }

  console.log(`Found ${schedules.length} schedule(s):\n`);

  for (const schedule of schedules) {
    const status = schedule.enabled ? '✅' : '⏸️';
    const nextRun = schedule.next_run_at
      ? formatDateTime(schedule.next_run_at)
      : 'N/A';

    console.log(`${status} ${schedule.name}`);
    console.log(`   Cron: ${schedule.cron_expression}`);
    console.log(`   Next: ${nextRun}`);
    console.log(`   Runs: ${schedule.run_count} (errors: ${schedule.error_count})`);
    console.log(`   ID: ${schedule.id}`);
    console.log();
  }
}

/** 実行ログ */
function showLogs(scheduleId?: string, limit: number = 10): void {
  const storage = new Storage();

  // 名前からIDを解決
  let resolvedId = scheduleId;
  if (scheduleId) {
    const schedule = storage.getScheduleByName(scheduleId);
    if (schedule) {
      resolvedId = schedule.id;
    }
  }

  const logs = storage.getExecutionLogs(resolvedId, limit);
  storage.close();

  if (logs.length === 0) {
    console.log('No execution logs found.');
    return;
  }

  console.log(`Execution logs (${logs.length}):\n`);

  for (const log of logs) {
    const status = log.status === 'success' ? '✅' : log.status === 'failed' ? '❌' : '🔄';
    const startedAt = formatDateTime(log.started_at);

    console.log(`${status} [${startedAt}]`);
    console.log(`   Schedule: ${log.schedule_id}`);
    console.log(`   Status: ${log.status}`);
    if (log.error) {
      console.log(`   Error: ${log.error}`);
    }
    if (log.output) {
      const truncated = log.output.length > 100
        ? log.output.substring(0, 100) + '...'
        : log.output;
      console.log(`   Output: ${truncated}`);
    }
    console.log();
  }
}

/** ヘルプ */
function showHelp(): void {
  console.log(`
claude-time - Claude Code Scheduler

Usage:
  claude-time <command> [options]

Daemon Commands:
  daemon start     Start the background daemon
  daemon stop      Stop the daemon
  daemon status    Show daemon status

Schedule Commands:
  list             List all schedules
  logs [id] [-n N] Show execution logs

Options:
  -n, --limit N    Limit number of results

Note:
  Use Claude Code MCP tools to add/remove schedules:
  - schedule_add
  - schedule_remove
  - schedule_pause
  - schedule_resume

Examples:
  claude-time daemon start
  claude-time daemon status
  claude-time list
  claude-time logs -n 20
`);
}

/**
 * -n オプションからlimit値をパースする
 */
function parseLimitOption(args: string[]): number {
  const limitIndex = args.indexOf('-n');
  if (limitIndex === -1) {
    return 10; // デフォルト
  }

  const limitArg = args[limitIndex + 1];
  if (limitArg === undefined) {
    console.error('Error: -n option requires a number');
    return 10;
  }

  const limit = parseInt(limitArg, 10);
  if (isNaN(limit) || limit < 1) {
    console.error(`Error: Invalid limit value: ${limitArg}`);
    return 10;
  }

  return limit;
}

// メイン処理
const args = process.argv.slice(2);
const command = args[0] || 'help';

switch (command) {
  case 'daemon':
    const subCommand = args[1] || 'status';
    switch (subCommand) {
      case 'start':
        daemonStart();
        break;
      case 'stop':
        daemonStop();
        break;
      case 'status':
        daemonStatus();
        break;
      default:
        console.error(`Unknown daemon command: ${subCommand}`);
        showHelp();
    }
    break;

  case 'list':
    listSchedules();
    break;

  case 'logs':
    const scheduleId = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
    const limit = parseLimitOption(args);
    showLogs(scheduleId, limit);
    break;

  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
