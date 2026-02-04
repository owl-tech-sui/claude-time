# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-02-04

### Added
- **Schedule editing** (`schedule_update`): Update name, schedule, prompt, or working directory of existing schedules
- **Log cleanup** (`schedule_cleanup`): Delete execution logs older than specified days
- **Dry-run mode** (`schedule_run --dry_run`): Preview what would be executed without actually running
- **Notifications**: macOS native notifications on schedule completion/failure
  - Configurable via `CLAUDE_TIME_NOTIFY=false` environment variable
- **Timezone support**: Automatic timezone detection with manual override
  - `CLAUDE_TIME_TZ` or `TZ` environment variables
- **DB change detection**: Scheduler automatically reloads when schedules are modified

### Changed
- Improved error handling and validation
- Better security: shell injection prevention in executor

### Fixed
- Cron regex now correctly handles `*/5` patterns
- Time validation rejects invalid hours (25:00) and minutes (9:99)
- Double-resolve bug on execution timeout

## [0.1.0] - 2025-02-03

### Added
- Initial implementation of Claude Code scheduler MCP server
- Natural language schedule parsing (English and Japanese)
  - "every 5 minutes", "every day at 9:00", "毎日9時", etc.
- Cron expression support
- SQLite storage for schedules and execution logs
- Background daemon with node-cron
- MCP tools:
  - `schedule_add`: Add new schedules
  - `schedule_list`: List all schedules
  - `schedule_remove`: Remove schedules
  - `schedule_pause`: Pause schedules
  - `schedule_resume`: Resume schedules
  - `schedule_logs`: View execution logs
  - `schedule_run`: Run schedules immediately
