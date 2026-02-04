/**
 * PIDファイル管理ユーティリティ
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PID_FILE = join(__dirname, '..', 'data', 'daemon.pid');
export const LOG_FILE = join(__dirname, '..', 'data', 'daemon.log');

/** PIDファイルを読み込む */
export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const content = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/** PIDファイルを書き込む */
export function writePid(pid: number): void {
  writeFileSync(PID_FILE, pid.toString(), 'utf-8');
}

/** PIDファイルを削除 */
export function removePid(): void {
  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  }
}

/** プロセスが存在するか確認 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** デーモンが実行中か確認し、古いPIDファイルをクリーンアップ */
export function checkDaemonRunning(): { running: boolean; pid: number | null } {
  const pid = readPid();
  if (!pid) {
    return { running: false, pid: null };
  }

  if (!isProcessRunning(pid)) {
    // 古いPIDファイルを削除
    removePid();
    return { running: false, pid: null };
  }

  return { running: true, pid };
}
