/**
 * Claude実行
 * claude -p でHeadless Mode実行を行う
 */

import { spawn, ChildProcess } from 'child_process';
import type { Schedule } from './types.js';

/** 実行タイムアウト（ミリ秒） */
const EXECUTION_TIMEOUT_MS = 10 * 60 * 1000; // 10分

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number | null;
}

/**
 * スケジュールを実行する
 */
export async function executeSchedule(schedule: Schedule): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    let resolved = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const safeResolve = (result: ExecutionResult) => {
      if (resolved) return;
      resolved = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      resolve(result);
    };

    const args = [
      '-p',
      schedule.prompt,
      '--output-format', 'text',
    ];

    // 作業ディレクトリ設定
    const options: { cwd?: string; env?: NodeJS.ProcessEnv } = {
      env: { ...process.env },
    };
    if (schedule.working_directory) {
      options.cwd = schedule.working_directory;
    }

    let proc: ChildProcess;
    try {
      // shell: false でコマンドインジェクションを防止
      proc = spawn('claude', args, {
        ...options,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      safeResolve({
        success: false,
        output: '',
        error: `Failed to spawn claude: ${message}`,
        exitCode: null,
      });
      return;
    }

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        safeResolve({
          success: true,
          output: stdout.trim(),
          exitCode: code,
        });
      } else {
        safeResolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`,
          exitCode: code,
        });
      }
    });

    proc.on('error', (err) => {
      safeResolve({
        success: false,
        output: '',
        error: `Failed to spawn claude: ${err.message}`,
        exitCode: null,
      });
    });

    // タイムアウト
    timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      // SIGTERMで終了しない場合、SIGKILLを送信
      setTimeout(() => {
        if (!resolved) {
          proc.kill('SIGKILL');
        }
      }, 5000);
      safeResolve({
        success: false,
        output: stdout.trim(),
        error: 'Execution timeout (10 minutes)',
        exitCode: null,
      });
    }, EXECUTION_TIMEOUT_MS);
  });
}
