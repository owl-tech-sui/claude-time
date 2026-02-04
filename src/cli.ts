#!/usr/bin/env node
/**
 * claude-time CLI
 * デーモン管理とスケジュール確認用のCLI
 */

import { spawn, execSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Storage } from './storage.js';
import {
  LOG_FILE,
  readPid,
  isProcessRunning,
  checkDaemonRunning,
} from './pid.js';
import { formatDateTime, getConfigInfo, getTmuxSession } from './config.js';
import {
  isTmuxInstalled,
  installTmux,
  sessionExists,
  createSession,
  destroySession,
  attachSession,
  sendToPane,
  sendMessageToPane,
  getSessionInfo,
  DEFAULT_SESSION,
  promptUser,
} from './tmux.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** launchd plistファイルのパス */
const PLIST_NAME = 'com.claude-time.daemon.plist';
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', PLIST_NAME);

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
    const modeIcon = schedule.mode === 'notify' ? '📢' : '🤖';
    const modeText = schedule.mode === 'notify'
      ? `notify → ${schedule.tmux_target || 'claude-time:0.1'}`
      : 'headless';

    console.log(`${status} ${schedule.name}`);
    console.log(`   Cron: ${schedule.cron_expression}`);
    console.log(`   Next: ${nextRun}`);
    console.log(`   Mode: ${modeIcon} ${modeText}`);
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

/** launchd にインストール */
function install(): void {
  if (process.platform !== 'darwin') {
    console.error('❌ This command is only available on macOS.');
    console.log('   For Linux, use systemd to manage the daemon.');
    return;
  }

  // 既にインストールされているか確認
  if (existsSync(PLIST_PATH)) {
    console.log('⚠️ claude-time is already installed.');
    console.log(`   Plist: ${PLIST_PATH}`);
    console.log('   Run `claude-time uninstall` first if you want to reinstall.');
    return;
  }

  // daemon.js のパス
  const daemonPath = join(__dirname, 'daemon.js');
  const nodePath = process.execPath;

  // plistファイルの内容
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-time.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${daemonPath}</string>
        <string>--foreground</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
    <key>WorkingDirectory</key>
    <string>${dirname(__dirname)}</string>
</dict>
</plist>
`;

  try {
    // LaunchAgents ディレクトリが存在することを確認
    const launchAgentsDir = dirname(PLIST_PATH);
    if (!existsSync(launchAgentsDir)) {
      console.error(`❌ Directory not found: ${launchAgentsDir}`);
      return;
    }

    // plistファイルを作成
    writeFileSync(PLIST_PATH, plistContent);
    console.log(`✅ Created: ${PLIST_PATH}`);

    // launchctl でロード
    try {
      execSync(`launchctl load ${PLIST_PATH}`, { stdio: 'pipe' });
      console.log('✅ Loaded into launchd');
    } catch (loadError) {
      console.log('⚠️ Could not load automatically. Run manually:');
      console.log(`   launchctl load ${PLIST_PATH}`);
    }

    console.log('\n🎉 Installation complete!');
    console.log('   The daemon will now start automatically on login.');
    console.log('   Check status: claude-time daemon status');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Installation failed: ${message}`);
  }
}

/** launchd からアンインストール */
function uninstall(): void {
  if (process.platform !== 'darwin') {
    console.error('❌ This command is only available on macOS.');
    return;
  }

  if (!existsSync(PLIST_PATH)) {
    console.log('ℹ️ claude-time is not installed (no plist found).');
    return;
  }

  try {
    // launchctl でアンロード
    try {
      execSync(`launchctl unload ${PLIST_PATH}`, { stdio: 'pipe' });
      console.log('✅ Unloaded from launchd');
    } catch (unloadError) {
      console.log('⚠️ Could not unload (may already be unloaded)');
    }

    // plistファイルを削除
    unlinkSync(PLIST_PATH);
    console.log(`✅ Removed: ${PLIST_PATH}`);

    console.log('\n🎉 Uninstallation complete!');
    console.log('   The daemon will no longer start automatically.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Uninstallation failed: ${message}`);
  }
}

/** tmuxセッションを起動してdaemonを開始 */
async function start(): Promise<void> {
  const sessionName = getTmuxSession();

  // 1. tmuxインストール確認
  if (!isTmuxInstalled()) {
    console.log('tmux is not installed.');
    const answer = await promptUser('Install tmux? [Y/n] ');
    if (answer.toLowerCase() === 'n') {
      console.log('Aborted. Please install tmux manually to use this feature.');
      return;
    }
    const installed = await installTmux();
    if (!installed) {
      console.log('Failed to install tmux. Aborting.');
      return;
    }
  }

  // 2. 既存セッション確認
  if (sessionExists(sessionName)) {
    console.log(`Session '${sessionName}' already exists.`);
    console.log('Attaching to existing session...');
    console.log(`\nTip: Use 'claude-time attach' to attach later.`);
    attachSession(sessionName);
    return;
  }

  // 3. セッション作成
  console.log(`Creating tmux session '${sessionName}'...`);
  const created = createSession(sessionName);
  if (!created) {
    console.error('Failed to create tmux session.');
    return;
  }

  // 4. daemon起動（Pane 0で）
  const daemonPath = join(__dirname, 'daemon.js');
  console.log('Starting daemon in pane 0...');

  // デーモンコマンドを送信
  sendToPane(`${sessionName}:0.0`, `node "${daemonPath}" --foreground`);
  sendToPane(`${sessionName}:0.0`, 'Enter');

  // 少し待つ
  await new Promise(resolve => setTimeout(resolve, 1500));

  // 状態確認
  const { running, pid } = checkDaemonRunning();

  console.log('');
  console.log('✅ claude-time started!');
  console.log('');
  console.log(`   Session: ${sessionName}`);
  console.log(`   Pane 0: Daemon ${running ? `(PID: ${pid})` : '(starting...)'}`);
  console.log(`   Pane 1: User shell (run 'claude' here)`);
  console.log('');
  console.log('Commands:');
  console.log('   claude-time attach  - Attach to session');
  console.log('   claude-time stop    - Stop session and daemon');
  console.log('   claude-time status  - Check status');
  console.log('');

  // アタッチするか確認
  const attachAnswer = await promptUser('Attach to session now? [Y/n] ');
  if (attachAnswer.toLowerCase() !== 'n') {
    attachSession(sessionName);
  }
}

/** tmuxセッションとdaemonを停止 */
function stop(): void {
  const sessionName = getTmuxSession();

  // daemonを停止
  const { running, pid } = checkDaemonRunning();
  if (running && pid) {
    console.log(`Stopping daemon (PID: ${pid})...`);
    try {
      process.kill(pid, 'SIGTERM');
      console.log('✅ Daemon stopped.');
    } catch (error) {
      console.log('⚠️ Could not stop daemon (may already be stopped).');
    }
  }

  // セッションを削除
  if (sessionExists(sessionName)) {
    console.log(`Destroying tmux session '${sessionName}'...`);
    const destroyed = destroySession(sessionName);
    if (destroyed) {
      console.log('✅ Session destroyed.');
    } else {
      console.log('⚠️ Could not destroy session.');
    }
  } else {
    console.log(`Session '${sessionName}' does not exist.`);
  }

  console.log('');
  console.log('claude-time stopped.');
}

/** tmuxセッションにアタッチ */
function attach(): void {
  const sessionName = getTmuxSession();

  if (!isTmuxInstalled()) {
    console.error('tmux is not installed. Run `claude-time start` first.');
    return;
  }

  if (!sessionExists(sessionName)) {
    console.error(`Session '${sessionName}' does not exist.`);
    console.log('Run `claude-time start` to create a new session.');
    return;
  }

  console.log(`Attaching to session '${sessionName}'...`);
  attachSession(sessionName);
}

/** テスト通知を送信 */
function testNotify(message: string): void {
  const sessionName = getTmuxSession();
  const target = `${sessionName}:0.1`;

  if (!sessionExists(sessionName)) {
    console.error(`Session '${sessionName}' does not exist.`);
    console.log('Run `claude-time start` first.');
    return;
  }

  const timestamp = new Date().toLocaleTimeString();
  const fullMessage = `[claude-time test ${timestamp}] ${message}`;

  const sent = sendMessageToPane(target, fullMessage);
  if (sent) {
    console.log(`✅ Notification sent to ${target}`);
  } else {
    console.error(`❌ Failed to send notification to ${target}`);
  }
}

/** インストール状態を表示 */
function showInstallStatus(): void {
  if (process.platform !== 'darwin') {
    console.log('ℹ️ Auto-start is only available on macOS (launchd).');
    return;
  }

  if (existsSync(PLIST_PATH)) {
    console.log('✅ claude-time is installed for auto-start');
    console.log(`   Plist: ${PLIST_PATH}`);

    // launchctl で状態確認
    try {
      const result = execSync('launchctl list | grep com.claude-time', { encoding: 'utf-8' });
      if (result.includes('com.claude-time')) {
        console.log('   Status: Loaded in launchd');
      }
    } catch {
      console.log('   Status: Not currently loaded');
    }
  } else {
    console.log('❌ claude-time is not installed for auto-start');
    console.log('   Run `claude-time install` to enable auto-start on login.');
  }
}

/** ヘルプ */
function showHelp(): void {
  console.log(`
claude-time - Claude Code Scheduler

Usage:
  claude-time <command> [options]

Quick Start (tmux integration):
  start            Create tmux session + start daemon (recommended)
  stop             Stop daemon + destroy tmux session
  attach           Attach to tmux session

Setup Commands (macOS auto-start):
  install          Install auto-start on login (launchd)
  uninstall        Remove auto-start
  status           Show installation and daemon status

Daemon Commands:
  daemon start     Start the background daemon only
  daemon stop      Stop the daemon
  daemon status    Show daemon status

Schedule Commands:
  list             List all schedules
  logs [id] [-n N] Show execution logs

Testing:
  test-notify MSG  Send a test notification to tmux pane

Options:
  -n, --limit N    Limit number of results

Note:
  Use Claude Code MCP tools to add/remove schedules:
  - schedule_add (with mode: 'headless' or 'notify')
  - schedule_remove
  - schedule_pause
  - schedule_resume

Examples:
  claude-time start          # Start with tmux (recommended)
  claude-time attach         # Attach to existing session
  claude-time stop           # Stop everything
  claude-time test-notify "Hello!"  # Test notification
  claude-time list           # List schedules
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
  case 'start':
    start().catch(console.error);
    break;

  case 'stop':
    stop();
    break;

  case 'attach':
    attach();
    break;

  case 'test-notify':
    const notifyMessage = args.slice(1).join(' ') || 'Test notification';
    testNotify(notifyMessage);
    break;

  case 'install':
    install();
    break;

  case 'uninstall':
    uninstall();
    break;

  case 'status':
    showInstallStatus();
    console.log();
    // tmuxセッション情報も表示
    const sessionName = getTmuxSession();
    if (isTmuxInstalled() && sessionExists(sessionName)) {
      const info = getSessionInfo(sessionName);
      if (info) {
        console.log(`\n📺 tmux session '${sessionName}': Active`);
        console.log(`   Windows: ${info.windows}, Attached: ${info.attached ? 'Yes' : 'No'}`);
      }
    } else if (isTmuxInstalled()) {
      console.log(`\nℹ️ tmux session '${sessionName}': Not running`);
      console.log('   Run `claude-time start` to create a session.');
    }
    console.log();
    daemonStatus();
    break;

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
