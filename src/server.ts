/**
 * MCPサーバー定義
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, statSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { Storage } from './storage.js';
import { parseSchedule, getNextRunTime } from './parser.js';
import { executeSchedule } from './executor.js';
import { formatDateTime } from './config.js';
import type { Schedule, ScheduleInput, ScheduleAddResult } from './types.js';

/**
 * working_directory のバリデーション
 * @returns エラーメッセージ（問題がなければnull）
 */
function validateWorkingDirectory(dir: string | undefined): string | null {
  if (!dir) return null; // 省略時はOK

  // 絶対パスかチェック
  if (!isAbsolute(dir)) {
    return `working_directory must be an absolute path: "${dir}"`;
  }

  // 存在チェック
  if (!existsSync(dir)) {
    return `working_directory does not exist: "${dir}"`;
  }

  // ディレクトリかチェック
  try {
    const stat = statSync(dir);
    if (!stat.isDirectory()) {
      return `working_directory is not a directory: "${dir}"`;
    }
  } catch {
    return `Cannot access working_directory: "${dir}"`;
  }

  return null;
}

export class MCPServer {
  private server: Server;
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
    this.server = new Server(
      {
        name: 'claude-time',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // ツール一覧
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'schedule_add',
          description: 'Add a new schedule. Supports natural language like "every day at 9:00", "毎日9時", or cron expressions.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the schedule',
              },
              schedule: {
                type: 'string',
                description: 'When to run (natural language or cron expression). Examples: "every day at 9:00", "毎日9時", "every 5 minutes", "0 9 * * *"',
              },
              prompt: {
                type: 'string',
                description: 'The prompt to execute with claude -p',
              },
              working_directory: {
                type: 'string',
                description: 'Working directory for execution (optional)',
              },
              description: {
                type: 'string',
                description: 'Description of the schedule (optional)',
              },
            },
            required: ['name', 'schedule', 'prompt'],
          },
        },
        {
          name: 'schedule_list',
          description: 'List all schedules',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'schedule_remove',
          description: 'Remove a schedule by ID or name',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Schedule ID or name to remove',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'schedule_pause',
          description: 'Pause a schedule',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Schedule ID or name to pause',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'schedule_resume',
          description: 'Resume a paused schedule',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Schedule ID or name to resume',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'schedule_logs',
          description: 'Get execution logs',
          inputSchema: {
            type: 'object',
            properties: {
              schedule_id: {
                type: 'string',
                description: 'Filter by schedule ID or name (optional)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of logs to return (default: 10)',
              },
            },
          },
        },
        {
          name: 'schedule_run',
          description: 'Run a schedule immediately (for testing)',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Schedule ID or name to run',
              },
            },
            required: ['id'],
          },
        },
      ],
    }));

    // ツール実行
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'schedule_add':
            return this.handleScheduleAdd(args as unknown as ScheduleInput);

          case 'schedule_list':
            return this.handleScheduleList();

          case 'schedule_remove':
            return this.handleScheduleRemove(args as { id: string });

          case 'schedule_pause':
            return this.handleSchedulePause(args as { id: string });

          case 'schedule_resume':
            return this.handleScheduleResume(args as { id: string });

          case 'schedule_logs':
            return this.handleScheduleLogs(args as { schedule_id?: string; limit?: number });

          case 'schedule_run':
            return this.handleScheduleRun(args as { id: string });

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  private findSchedule(idOrName: string): Schedule | null {
    // まずIDで検索
    let schedule = this.storage.getSchedule(idOrName);
    if (schedule) return schedule;

    // 次に名前で検索
    schedule = this.storage.getScheduleByName(idOrName);
    return schedule;
  }

  private async handleScheduleAdd(input: ScheduleInput) {
    // working_directory のバリデーション
    const dirError = validateWorkingDirectory(input.working_directory);
    if (dirError) {
      return {
        content: [{ type: 'text', text: `Error: ${dirError}` }],
        isError: true,
      };
    }

    // スケジュールをパース
    const parseResult = parseSchedule(input.schedule);
    if (!parseResult.success || !parseResult.cron_expression) {
      return {
        content: [{ type: 'text', text: `Error: ${parseResult.error}` }],
        isError: true,
      };
    }

    // 次回実行時刻を計算
    const nextRun = getNextRunTime(parseResult.cron_expression);
    const now = new Date().toISOString();

    // 絶対パスに正規化
    const workingDir = input.working_directory ? resolve(input.working_directory) : null;

    const schedule: Schedule = {
      id: uuidv4(),
      name: input.name,
      description: input.description || null,
      cron_expression: parseResult.cron_expression,
      prompt: input.prompt,
      working_directory: workingDir,
      enabled: true,
      created_at: now,
      updated_at: now,
      last_run_at: null,
      next_run_at: nextRun?.toISOString() || null,
      run_count: 0,
      error_count: 0,
    };

    this.storage.addSchedule(schedule);

    const result: ScheduleAddResult = {
      id: schedule.id,
      name: schedule.name,
      cron_expression: schedule.cron_expression,
      next_run_at: schedule.next_run_at || 'Unknown',
      message: `Schedule "${schedule.name}" added successfully!`,
    };

    const nextRunFormatted = nextRun
      ? formatDateTime(nextRun)
      : 'Unknown';

    return {
      content: [{
        type: 'text',
        text: [
          `✅ Schedule added successfully!`,
          ``,
          `- **Name**: ${result.name}`,
          `- **Cron**: ${result.cron_expression}`,
          `- **Next run**: ${nextRunFormatted}`,
          `- **ID**: ${result.id}`,
          ``,
          `Note: Start the daemon with \`claude-time daemon start\` to execute schedules.`,
        ].join('\n'),
      }],
    };
  }

  private async handleScheduleList() {
    const schedules = this.storage.getAllSchedules();

    if (schedules.length === 0) {
      return {
        content: [{ type: 'text', text: 'No schedules found.' }],
      };
    }

    const lines = schedules.map((s) => {
      const status = s.enabled ? '✅' : '⏸️';
      const nextRun = s.next_run_at
        ? formatDateTime(s.next_run_at)
        : 'N/A';
      return [
        `${status} **${s.name}**`,
        `   - Cron: ${s.cron_expression}`,
        `   - Next: ${nextRun}`,
        `   - Runs: ${s.run_count} (errors: ${s.error_count})`,
        `   - ID: ${s.id}`,
      ].join('\n');
    });

    return {
      content: [{
        type: 'text',
        text: `Found ${schedules.length} schedule(s):\n\n${lines.join('\n\n')}`,
      }],
    };
  }

  private async handleScheduleRemove(args: { id: string }) {
    const schedule = this.findSchedule(args.id);
    if (!schedule) {
      return {
        content: [{ type: 'text', text: `Schedule not found: ${args.id}` }],
        isError: true,
      };
    }

    this.storage.deleteSchedule(schedule.id);

    return {
      content: [{
        type: 'text',
        text: `✅ Schedule "${schedule.name}" removed successfully.`,
      }],
    };
  }

  private async handleSchedulePause(args: { id: string }) {
    const schedule = this.findSchedule(args.id);
    if (!schedule) {
      return {
        content: [{ type: 'text', text: `Schedule not found: ${args.id}` }],
        isError: true,
      };
    }

    this.storage.updateSchedule(schedule.id, { enabled: false });

    return {
      content: [{
        type: 'text',
        text: `⏸️ Schedule "${schedule.name}" paused.`,
      }],
    };
  }

  private async handleScheduleResume(args: { id: string }) {
    const schedule = this.findSchedule(args.id);
    if (!schedule) {
      return {
        content: [{ type: 'text', text: `Schedule not found: ${args.id}` }],
        isError: true,
      };
    }

    // 次回実行時刻を再計算
    const nextRun = getNextRunTime(schedule.cron_expression);

    this.storage.updateSchedule(schedule.id, {
      enabled: true,
      next_run_at: nextRun?.toISOString() || null,
    });

    return {
      content: [{
        type: 'text',
        text: `▶️ Schedule "${schedule.name}" resumed.`,
      }],
    };
  }

  private async handleScheduleLogs(args: { schedule_id?: string; limit?: number }) {
    let scheduleId = args.schedule_id;

    // 名前でも検索できるようにする
    if (scheduleId) {
      const schedule = this.findSchedule(scheduleId);
      if (schedule) {
        scheduleId = schedule.id;
      }
    }

    const logs = this.storage.getExecutionLogs(scheduleId, args.limit || 10);

    if (logs.length === 0) {
      return {
        content: [{ type: 'text', text: 'No execution logs found.' }],
      };
    }

    const lines = logs.map((log) => {
      const status = log.status === 'success' ? '✅' : log.status === 'failed' ? '❌' : '🔄';
      const startedAt = formatDateTime(log.started_at);
      return [
        `${status} [${startedAt}]`,
        `   Schedule: ${log.schedule_id}`,
        `   Status: ${log.status}`,
        log.error ? `   Error: ${log.error}` : null,
        log.output ? `   Output: ${log.output.substring(0, 100)}${log.output.length > 100 ? '...' : ''}` : null,
      ].filter(Boolean).join('\n');
    });

    return {
      content: [{
        type: 'text',
        text: `Execution logs (${logs.length}):\n\n${lines.join('\n\n')}`,
      }],
    };
  }

  private async handleScheduleRun(args: { id: string }) {
    const schedule = this.findSchedule(args.id);
    if (!schedule) {
      return {
        content: [{ type: 'text', text: `Schedule not found: ${args.id}` }],
        isError: true,
      };
    }

    if (!schedule.enabled) {
      return {
        content: [{ type: 'text', text: `Schedule "${schedule.name}" is paused. Resume it first.` }],
        isError: true,
      };
    }

    // 実行ログを作成
    const logId = this.storage.addExecutionLog({
      schedule_id: schedule.id,
      started_at: new Date().toISOString(),
      completed_at: null,
      status: 'running',
      output: null,
      error: null,
    });

    // 即時実行
    const result = await executeSchedule(schedule);

    // ログを更新
    this.storage.updateExecutionLog(logId, {
      completed_at: new Date().toISOString(),
      status: result.success ? 'success' : 'failed',
      output: result.output,
      error: result.error || null,
    });

    // 実行回数を更新
    this.storage.incrementRunCount(schedule.id, result.success);

    if (result.success) {
      return {
        content: [{
          type: 'text',
          text: [
            `✅ Schedule "${schedule.name}" executed successfully!`,
            ``,
            `**Output:**`,
            '```',
            result.output || '(no output)',
            '```',
          ].join('\n'),
        }],
      };
    } else {
      return {
        content: [{
          type: 'text',
          text: [
            `❌ Schedule "${schedule.name}" failed.`,
            ``,
            `**Error:** ${result.error}`,
            result.output ? `\n**Output:**\n\`\`\`\n${result.output}\n\`\`\`` : '',
          ].join('\n'),
        }],
        isError: true,
      };
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP Server] claude-time started');
  }
}
