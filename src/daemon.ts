#!/usr/bin/env node
/**
 * claude-time デーモン
 * スケジュールされたタスクを実行するバックグラウンドプロセス
 */

import { createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { Storage } from './storage.js';
import { Scheduler } from './scheduler.js';
import { formatDateTime } from './config.js';
import {
  PID_FILE,
  LOG_FILE,
  readPid,
  writePid,
  removePid,
  isProcessRunning,
  checkDaemonRunning,
} from './pid.js';

/** デーモンをフォアグラウンドで起動 */
async function runForeground(): Promise<void> {
  console.log('[Daemon] Starting in foreground mode...');

  const storage = new Storage();
  const scheduler = new Scheduler(storage);

  // 終了ハンドラ
  const cleanup = () => {
    console.log('[Daemon] Shutting down...');
    scheduler.stop();
    storage.close();
    removePid();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // PIDを記録
  writePid(process.pid);

  // スケジューラーを開始
  scheduler.start();

  console.log('[Daemon] Running. Press Ctrl+C to stop.');

  // プロセスを維持
  await new Promise(() => {});
}

/** デーモンをバックグラウンドで起動 */
function startDaemon(): void {
  const { running, pid: existingPid } = checkDaemonRunning();
  if (running) {
    console.log(`Daemon is already running (PID: ${existingPid})`);
    return;
  }

  console.log('Starting daemon...');

  const daemonScript = new URL('./daemon.js', import.meta.url).pathname;
  const child = spawn('node', [daemonScript, '--foreground'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  // ログをファイルに出力
  const logStream = createWriteStream(LOG_FILE, { flags: 'a' });
  logStream.on('error', (err) => {
    console.error('Log stream error:', err.message);
  });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  child.unref();

  // 少し待ってからPIDを確認
  setTimeout(() => {
    const pid = readPid();
    if (pid && isProcessRunning(pid)) {
      console.log(`Daemon started (PID: ${pid})`);
      console.log(`Log file: ${LOG_FILE}`);
    } else {
      console.error('Failed to start daemon. Check the log file.');
    }
  }, 500);
}

/** デーモンを停止 */
function stopDaemon(): void {
  const { running, pid } = checkDaemonRunning();
  if (!running || !pid) {
    console.log('Daemon is not running.');
    return;
  }

  console.log(`Stopping daemon (PID: ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
    console.log('Daemon stopped.');
  } catch (error) {
    console.error('Failed to stop daemon:', error);
  }
  removePid();
}

/** デーモンのステータスを表示 */
function showStatus(): void {
  const { running, pid } = checkDaemonRunning();
  if (!running) {
    console.log('Daemon is not running.');
    return;
  }

  const storage = new Storage();
  const schedules = storage.getEnabledSchedules();
  storage.close();

  console.log(`Daemon is running (PID: ${pid})`);
  console.log(`Active schedules: ${schedules.length}`);

  if (schedules.length > 0) {
    console.log('\nSchedules:');
    for (const schedule of schedules) {
      const nextRun = schedule.next_run_at
        ? formatDateTime(schedule.next_run_at)
        : 'N/A';
      console.log(`  - ${schedule.name} (${schedule.cron_expression}) → Next: ${nextRun}`);
    }
  }
}

/** ヘルプを表示 */
function showHelp(): void {
  console.log(`
claude-time daemon

Commands:
  start       Start the daemon in background
  stop        Stop the daemon
  status      Show daemon status
  foreground  Run in foreground (for debugging)
  help        Show this help

Usage:
  node daemon.js start
  node daemon.js stop
  node daemon.js status
`);
}

// メイン処理
const command = process.argv[2] || 'help';

switch (command) {
  case 'start':
    startDaemon();
    break;
  case 'stop':
    stopDaemon();
    break;
  case 'status':
    showStatus();
    break;
  case '--foreground':
  case 'foreground':
    runForeground().catch(console.error);
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
