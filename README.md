# claude-time

Claude Code用の汎用スケジューラーMCPサーバー

どのプロジェクトでも使える、自然言語でスケジュール設定できるMCPサーバーです。

## 機能

- 自然言語でスケジュール設定（「毎日9時」「every 5 minutes」など）
- cron式も直接使用可能
- Claude Code（Headless Mode）でタスク実行
- SQLiteでスケジュール永続化
- バックグラウンドデーモンで自動実行

## インストール

```bash
cd ~/dev/claude-time
npm install
npm run build
```

## Claude Codeへの登録

```bash
claude mcp add claude-time -t stdio -- node ~/dev/claude-time/dist/index.js
```

または、`~/.claude.json` を直接編集:

```json
{
  "mcpServers": {
    "claude-time": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/win/dev/claude-time/dist/index.js"]
    }
  }
}
```

## 使い方

### Claude Code内でスケジュール管理

```
$ claude
> 毎日9時にgit statusを確認するスケジュール追加して

Claude: スケジュールを追加しました！
  - 名前: git status確認
  - 実行時間: 毎日 09:00
  - 次回実行: 明日 09:00
```

### サポートする自然言語パターン

| 入力例 | cron式 |
|--------|--------|
| `every 5 minutes` | `*/5 * * * *` |
| `5分ごと` | `*/5 * * * *` |
| `every hour` | `0 * * * *` |
| `every day at 9:00` | `0 9 * * *` |
| `毎日9時` | `0 9 * * *` |
| `daily at 21:30` | `30 21 * * *` |
| `every monday at 10:00` | `0 10 * * 1` |
| `毎週月曜9時` | `0 9 * * 1` |
| `weekdays at 9:00` | `0 9 * * 1-5` |
| `平日9時` | `0 9 * * 1-5` |
| `weekend at 18:00` | `0 18 * * 0,6` |

### MCPツール

- `schedule_add` - スケジュール追加
- `schedule_list` - スケジュール一覧
- `schedule_remove` - スケジュール削除
- `schedule_pause` - スケジュール一時停止
- `schedule_resume` - スケジュール再開
- `schedule_logs` - 実行ログ確認

### デーモン管理

スケジュールを自動実行するにはデーモンを起動する必要があります。

```bash
# デーモン起動
claude-time daemon start

# ステータス確認
claude-time daemon status

# デーモン停止
claude-time daemon stop
```

### CLI

```bash
# スケジュール一覧
claude-time list

# 実行ログ確認
claude-time logs

# 特定スケジュールのログ
claude-time logs "git status確認" -n 20
```

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code                          │
│  (自然言語でスケジュール指示)                             │
└───────────────────────┬─────────────────────────────────┘
                        │ MCP Protocol (stdio)
                        ▼
┌─────────────────────────────────────────────────────────┐
│              claude-time MCP Server                     │
│  - スケジュール管理ツール                                │
│  - SQLite ストレージ                                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              claude-time Daemon                         │
│  - node-cron でタイムトリガー                           │
│  - claude -p でHeadless実行                             │
└─────────────────────────────────────────────────────────┘
```

## データ

スケジュールと実行ログは `data/claude-time.db` (SQLite) に保存されます。

## ライセンス

MIT
