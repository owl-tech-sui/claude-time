/**
 * 通知機能
 * macOS: osascript を使用
 * 他のOS: console.log にフォールバック
 */

import { spawn } from 'child_process';
import { platform } from 'os';

export interface NotificationOptions {
  title: string;
  message: string;
  sound?: boolean;
}

/**
 * 通知を送信する
 * 環境変数 CLAUDE_TIME_NOTIFY=false で無効化可能
 */
export async function sendNotification(options: NotificationOptions): Promise<void> {
  // 環境変数で無効化されている場合はスキップ
  if (process.env.CLAUDE_TIME_NOTIFY === 'false') {
    return;
  }

  const { title, message, sound = true } = options;

  if (platform() === 'darwin') {
    await sendMacNotification(title, message, sound);
  } else {
    // 他のOSではコンソールに出力
    console.log(`[Notification] ${title}: ${message}`);
  }
}

/**
 * macOS用通知（osascript使用）
 */
async function sendMacNotification(title: string, message: string, sound: boolean): Promise<void> {
  return new Promise((resolve) => {
    const soundOption = sound ? 'with sound "default"' : '';
    const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}" ${soundOption}`;

    const proc = spawn('osascript', ['-e', script], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    proc.on('close', () => resolve());
    proc.on('error', () => resolve()); // エラーでも継続
  });
}

/**
 * AppleScript文字列のエスケープ
 */
function escapeAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * スケジュール実行成功時の通知
 */
export async function notifySuccess(scheduleName: string): Promise<void> {
  await sendNotification({
    title: 'claude-time',
    message: `✅ "${scheduleName}" completed successfully`,
    sound: false,
  });
}

/**
 * スケジュール実行失敗時の通知
 */
export async function notifyFailure(scheduleName: string, error?: string): Promise<void> {
  const message = error
    ? `❌ "${scheduleName}" failed: ${error.substring(0, 100)}`
    : `❌ "${scheduleName}" failed`;

  await sendNotification({
    title: 'claude-time',
    message,
    sound: true, // 失敗時はサウンドで通知
  });
}
