/**
 * tmux管理モジュール
 * セッション作成、ペイン管理、メッセージ送信機能を提供
 */

import { execSync, spawnSync } from 'child_process';
import { platform } from 'os';
import * as readline from 'readline';

/** デフォルト設定 */
export const DEFAULT_SESSION = 'claude-time';
export const DAEMON_PANE = '0';
export const USER_PANE = '1';

/**
 * コマンドが存在するか確認
 */
function commandExists(command: string): boolean {
  try {
    const result = spawnSync('which', [command], { encoding: 'utf-8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * tmuxがインストールされているか確認
 */
export function isTmuxInstalled(): boolean {
  return commandExists('tmux');
}

/**
 * tmuxのバージョンを取得
 */
export function getTmuxVersion(): string | null {
  try {
    const result = execSync('tmux -V', { encoding: 'utf-8' });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * tmuxを自動インストール（ユーザー確認付き）
 * @returns インストール成功したらtrue
 */
export async function installTmux(): Promise<boolean> {
  const os = platform();

  let installCommand: string | null = null;

  if (os === 'darwin') {
    // macOS
    if (commandExists('brew')) {
      installCommand = 'brew install tmux';
    } else {
      console.log('Homebrew is not installed. Please install tmux manually:');
      console.log('  1. Install Homebrew: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
      console.log('  2. Run: brew install tmux');
      return false;
    }
  } else if (os === 'linux') {
    // Linux
    if (commandExists('apt')) {
      installCommand = 'sudo apt install -y tmux';
    } else if (commandExists('apt-get')) {
      installCommand = 'sudo apt-get install -y tmux';
    } else if (commandExists('yum')) {
      installCommand = 'sudo yum install -y tmux';
    } else if (commandExists('dnf')) {
      installCommand = 'sudo dnf install -y tmux';
    } else if (commandExists('pacman')) {
      installCommand = 'sudo pacman -S --noconfirm tmux';
    } else {
      console.log('Could not detect package manager. Please install tmux manually.');
      return false;
    }
  } else {
    console.log(`Automatic tmux installation is not supported on ${os}.`);
    console.log('Please install tmux manually.');
    return false;
  }

  console.log(`Installing tmux with: ${installCommand}`);

  try {
    execSync(installCommand, { stdio: 'inherit' });
    console.log('tmux installed successfully!');
    return true;
  } catch (error) {
    console.error('Failed to install tmux. Please install it manually.');
    return false;
  }
}

/**
 * ユーザーに確認を求める
 */
export async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * セッションが存在するか確認
 */
export function sessionExists(sessionName: string = DEFAULT_SESSION): boolean {
  try {
    const result = spawnSync('tmux', ['has-session', '-t', sessionName], {
      encoding: 'utf-8',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * セッション作成（2ペイン構成）
 * - Pane 0: daemon用
 * - Pane 1: user用（Claudeを実行する）
 */
export function createSession(sessionName: string = DEFAULT_SESSION): boolean {
  if (sessionExists(sessionName)) {
    console.log(`Session '${sessionName}' already exists.`);
    return false;
  }

  try {
    // 新しいセッションを作成（デタッチ状態で）
    execSync(`tmux new-session -d -s "${sessionName}" -n "main"`, {
      encoding: 'utf-8',
    });

    // 水平分割でペインを追加
    execSync(`tmux split-window -h -t "${sessionName}:0"`, {
      encoding: 'utf-8',
    });

    // ペイン0のサイズを調整（左側30%、右側70%）
    execSync(`tmux resize-pane -t "${sessionName}:0.0" -x 30%`, {
      encoding: 'utf-8',
    });

    // ペイン0にラベルを設定（コメントとして）
    sendToPane(`${sessionName}:0.0`, '# Daemon pane');
    sendToPane(`${sessionName}:0.0`, 'Enter');

    // ペイン1にラベルを設定
    sendToPane(`${sessionName}:0.1`, '# User pane - Run `claude` here');
    sendToPane(`${sessionName}:0.1`, 'Enter');

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create session: ${message}`);
    return false;
  }
}

/**
 * セッション削除
 */
export function destroySession(sessionName: string = DEFAULT_SESSION): boolean {
  if (!sessionExists(sessionName)) {
    console.log(`Session '${sessionName}' does not exist.`);
    return false;
  }

  try {
    execSync(`tmux kill-session -t "${sessionName}"`, { encoding: 'utf-8' });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to destroy session: ${message}`);
    return false;
  }
}

/**
 * セッションにアタッチ
 */
export function attachSession(sessionName: string = DEFAULT_SESSION): void {
  if (!sessionExists(sessionName)) {
    console.error(`Session '${sessionName}' does not exist.`);
    return;
  }

  // アタッチはプロセスを置き換えるため、execSyncでは動かない
  // 呼び出し元でexecを使う必要がある
  const result = spawnSync('tmux', ['attach-session', '-t', sessionName], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error('Failed to attach to session.');
  }
}

/**
 * ペインにメッセージを送信
 * @param target tmux target (session:window.pane 形式)
 * @param message 送信するメッセージ
 */
export function sendToPane(target: string, message: string): boolean {
  try {
    // メッセージ内の特殊文字をエスケープ
    const escapedMessage = message
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');

    if (message === 'Enter') {
      // Enterキーを送信
      execSync(`tmux send-keys -t "${target}" Enter`, { encoding: 'utf-8' });
    } else {
      // 通常のメッセージを送信
      execSync(`tmux send-keys -t "${target}" "${escapedMessage}"`, {
        encoding: 'utf-8',
      });
    }
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to send to pane: ${errorMessage}`);
    return false;
  }
}

/**
 * ペインにメッセージを送信してEnterを押す
 */
export function sendMessageToPane(
  target: string,
  message: string
): boolean {
  const sent = sendToPane(target, message);
  if (!sent) return false;

  return sendToPane(target, 'Enter');
}

/**
 * 通知をtmuxペインに送信
 * スケジューラーから呼び出される
 */
export function sendNotificationToTmux(
  message: string,
  target?: string
): boolean {
  const actualTarget = target || `${DEFAULT_SESSION}:0.${USER_PANE}`;

  // セッションが存在するか確認
  const sessionName = actualTarget.split(':')[0];
  if (!sessionExists(sessionName)) {
    console.error(`tmux session '${sessionName}' does not exist.`);
    return false;
  }

  return sendMessageToPane(actualTarget, message);
}

/**
 * セッション一覧を取得
 */
export function listSessions(): string[] {
  try {
    const result = execSync('tmux list-sessions -F "#{session_name}"', {
      encoding: 'utf-8',
    });
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * セッションの情報を取得
 */
export interface SessionInfo {
  name: string;
  windows: number;
  attached: boolean;
  created: string;
}

export function getSessionInfo(sessionName: string = DEFAULT_SESSION): SessionInfo | null {
  if (!sessionExists(sessionName)) {
    return null;
  }

  try {
    const result = execSync(
      `tmux list-sessions -F "#{session_name}:#{session_windows}:#{session_attached}:#{session_created}" | grep "^${sessionName}:"`,
      { encoding: 'utf-8' }
    );
    const [name, windows, attached, created] = result.trim().split(':');
    return {
      name,
      windows: parseInt(windows, 10),
      attached: attached === '1',
      created: new Date(parseInt(created, 10) * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * ペインの内容をキャプチャ（デバッグ用）
 */
export function capturePane(target: string, lines: number = 10): string | null {
  try {
    const result = execSync(
      `tmux capture-pane -t "${target}" -p -S -${lines}`,
      { encoding: 'utf-8' }
    );
    return result;
  } catch {
    return null;
  }
}
