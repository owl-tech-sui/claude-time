/**
 * 設定管理
 */

/**
 * タイムゾーンを取得する
 * 優先順位:
 * 1. CLAUDE_TIME_TZ 環境変数
 * 2. TZ 環境変数
 * 3. システムのデフォルト（Intl API で検出）
 */
export function getTimezone(): string {
  // 環境変数を優先
  if (process.env.CLAUDE_TIME_TZ) {
    return process.env.CLAUDE_TIME_TZ;
  }

  if (process.env.TZ) {
    return process.env.TZ;
  }

  // システムのタイムゾーンを検出
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // フォールバック: UTC
    return 'UTC';
  }
}

/**
 * ロケールを取得する
 * 優先順位:
 * 1. CLAUDE_TIME_LOCALE 環境変数
 * 2. LANG 環境変数から推測
 * 3. システムのデフォルト
 */
export function getLocale(): string {
  if (process.env.CLAUDE_TIME_LOCALE) {
    return process.env.CLAUDE_TIME_LOCALE;
  }

  // LANG環境変数から推測 (例: ja_JP.UTF-8 → ja-JP)
  if (process.env.LANG) {
    const match = process.env.LANG.match(/^([a-z]{2})_([A-Z]{2})/);
    if (match) {
      return `${match[1]}-${match[2]}`;
    }
  }

  // システムのロケールを検出
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en-US';
  }
}

/**
 * 日時をローカル表示用にフォーマットする
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = getTimezone();
  const locale = getLocale();

  return d.toLocaleString(locale, { timeZone: tz });
}

/**
 * 設定情報を表示用に取得
 */
export function getConfigInfo(): { timezone: string; locale: string } {
  return {
    timezone: getTimezone(),
    locale: getLocale(),
  };
}
