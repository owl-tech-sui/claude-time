/**
 * 自然言語 → cron式 パーサー
 */

import type { ParseResult } from './types.js';

/** 曜日のマッピング */
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  // 日本語
  日曜: 0, 日: 0,
  月曜: 1, 月: 1,
  火曜: 2, 火: 2,
  水曜: 3, 水: 3,
  木曜: 4, 木: 4,
  金曜: 5, 金: 5,
  土曜: 6, 土: 6,
};

/** cron式のバリデーション正規表現 */
const CRON_REGEX = /^(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)$/;

/**
 * 時刻が有効な範囲かチェックする
 */
function isValidTime(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/**
 * 時刻文字列をパースする
 * @param timeStr "9:00", "9am", "21:30", "9時", "9時30分" など
 * @returns [hour, minute] or null
 */
function parseTime(timeStr: string): [number, number] | null {
  // 9:00, 21:30 形式
  const colonMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    const hour = parseInt(colonMatch[1], 10);
    const minute = parseInt(colonMatch[2], 10);
    if (!isValidTime(hour, minute)) return null;
    return [hour, minute];
  }

  // 9am, 9pm, 9 am, 9 pm 形式
  const ampmMatch = timeStr.match(/^(\d{1,2})\s*(am|pm)$/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    if (hour < 1 || hour > 12) return null;
    const isPM = ampmMatch[2].toLowerCase() === 'pm';
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return [hour, 0];
  }

  // 9時, 9時30分 形式
  const jpMatch = timeStr.match(/^(\d{1,2})時(?:(\d{1,2})分)?$/);
  if (jpMatch) {
    const hour = parseInt(jpMatch[1], 10);
    const minute = jpMatch[2] ? parseInt(jpMatch[2], 10) : 0;
    if (!isValidTime(hour, minute)) return null;
    return [hour, minute];
  }

  // 単純な数字（時間のみ）
  const numMatch = timeStr.match(/^(\d{1,2})$/);
  if (numMatch) {
    const hour = parseInt(numMatch[1], 10);
    if (hour < 0 || hour > 23) return null;
    return [hour, 0];
  }

  return null;
}

/**
 * 自然言語をcron式に変換する
 */
export function parseSchedule(input: string): ParseResult {
  const normalized = input.toLowerCase().trim();

  // すでにcron式の場合はそのまま返す
  if (CRON_REGEX.test(normalized)) {
    return {
      success: true,
      cron_expression: normalized,
      human_readable: 'Custom cron expression',
    };
  }

  // パターンマッチング

  // every X minutes
  const everyMinutesMatch = normalized.match(/every\s+(\d+)\s+minutes?/);
  if (everyMinutesMatch) {
    const minutes = parseInt(everyMinutesMatch[1], 10);
    if (minutes > 0 && minutes <= 59) {
      return {
        success: true,
        cron_expression: `*/${minutes} * * * *`,
        human_readable: `Every ${minutes} minute${minutes > 1 ? 's' : ''}`,
      };
    }
  }

  // X分ごと / X分毎
  const jpMinutesMatch = normalized.match(/(\d+)分(ごと|毎)/);
  if (jpMinutesMatch) {
    const minutes = parseInt(jpMinutesMatch[1], 10);
    if (minutes > 0 && minutes <= 59) {
      return {
        success: true,
        cron_expression: `*/${minutes} * * * *`,
        human_readable: `${minutes}分ごと`,
      };
    }
  }

  // every hour
  if (/every\s+hour/.test(normalized) || /毎時|1時間(ごと|毎)/.test(normalized)) {
    return {
      success: true,
      cron_expression: '0 * * * *',
      human_readable: 'Every hour',
    };
  }

  // every X hours
  const everyHoursMatch = normalized.match(/every\s+(\d+)\s+hours?/);
  if (everyHoursMatch) {
    const hours = parseInt(everyHoursMatch[1], 10);
    if (hours > 0 && hours <= 23) {
      return {
        success: true,
        cron_expression: `0 */${hours} * * *`,
        human_readable: `Every ${hours} hour${hours > 1 ? 's' : ''}`,
      };
    }
  }

  // X時間ごと / X時間毎
  const jpHoursMatch = normalized.match(/(\d+)時間(ごと|毎)/);
  if (jpHoursMatch) {
    const hours = parseInt(jpHoursMatch[1], 10);
    if (hours > 0 && hours <= 23) {
      return {
        success: true,
        cron_expression: `0 */${hours} * * *`,
        human_readable: `${hours}時間ごと`,
      };
    }
  }

  // every day at TIME / daily at TIME
  const dailyMatch = normalized.match(/(every\s+day|daily|毎日)\s*(at\s+)?(.+)/);
  if (dailyMatch) {
    const time = parseTime(dailyMatch[3].trim());
    if (time) {
      return {
        success: true,
        cron_expression: `${time[1]} ${time[0]} * * *`,
        human_readable: `Every day at ${time[0]}:${time[1].toString().padStart(2, '0')}`,
      };
    }
  }

  // 毎日X時 (時刻が先頭)
  const jpDailyMatch = normalized.match(/毎日\s*(\d{1,2})時(?:(\d{1,2})分)?/);
  if (jpDailyMatch) {
    const hour = parseInt(jpDailyMatch[1], 10);
    const minute = jpDailyMatch[2] ? parseInt(jpDailyMatch[2], 10) : 0;
    return {
      success: true,
      cron_expression: `${minute} ${hour} * * *`,
      human_readable: `毎日 ${hour}:${minute.toString().padStart(2, '0')}`,
    };
  }

  // every WEEKDAY at TIME
  for (const [dayName, dayNum] of Object.entries(WEEKDAYS)) {
    const weekdayMatch = normalized.match(new RegExp(`every\\s+${dayName}\\s+(?:at\\s+)?(.+)`));
    if (weekdayMatch) {
      const time = parseTime(weekdayMatch[1].trim());
      if (time) {
        return {
          success: true,
          cron_expression: `${time[1]} ${time[0]} * * ${dayNum}`,
          human_readable: `Every ${dayName} at ${time[0]}:${time[1].toString().padStart(2, '0')}`,
        };
      }
    }
  }

  // 毎週X曜日 X時
  for (const [dayName, dayNum] of Object.entries(WEEKDAYS)) {
    const jpWeekdayMatch = normalized.match(new RegExp(`毎週${dayName}(?:日)?\\s*(\\d{1,2})時(?:(\\d{1,2})分)?`));
    if (jpWeekdayMatch) {
      const hour = parseInt(jpWeekdayMatch[1], 10);
      const minute = jpWeekdayMatch[2] ? parseInt(jpWeekdayMatch[2], 10) : 0;
      return {
        success: true,
        cron_expression: `${minute} ${hour} * * ${dayNum}`,
        human_readable: `毎週${dayName}曜日 ${hour}:${minute.toString().padStart(2, '0')}`,
      };
    }
  }

  // weekdays at TIME
  const weekdaysMatch = normalized.match(/weekdays?\s+(?:at\s+)?(.+)/);
  if (weekdaysMatch) {
    const time = parseTime(weekdaysMatch[1].trim());
    if (time) {
      return {
        success: true,
        cron_expression: `${time[1]} ${time[0]} * * 1-5`,
        human_readable: `Weekdays at ${time[0]}:${time[1].toString().padStart(2, '0')}`,
      };
    }
  }

  // 平日 X時
  const jpWeekdaysMatch = normalized.match(/平日\s*(\d{1,2})時(?:(\d{1,2})分)?/);
  if (jpWeekdaysMatch) {
    const hour = parseInt(jpWeekdaysMatch[1], 10);
    const minute = jpWeekdaysMatch[2] ? parseInt(jpWeekdaysMatch[2], 10) : 0;
    return {
      success: true,
      cron_expression: `${minute} ${hour} * * 1-5`,
      human_readable: `平日 ${hour}:${minute.toString().padStart(2, '0')}`,
    };
  }

  // weekend at TIME
  const weekendMatch = normalized.match(/weekends?\s+(?:at\s+)?(.+)/);
  if (weekendMatch) {
    const time = parseTime(weekendMatch[1].trim());
    if (time) {
      return {
        success: true,
        cron_expression: `${time[1]} ${time[0]} * * 0,6`,
        human_readable: `Weekends at ${time[0]}:${time[1].toString().padStart(2, '0')}`,
      };
    }
  }

  // 週末 X時
  const jpWeekendMatch = normalized.match(/週末\s*(\d{1,2})時(?:(\d{1,2})分)?/);
  if (jpWeekendMatch) {
    const hour = parseInt(jpWeekendMatch[1], 10);
    const minute = jpWeekendMatch[2] ? parseInt(jpWeekendMatch[2], 10) : 0;
    return {
      success: true,
      cron_expression: `${minute} ${hour} * * 0,6`,
      human_readable: `週末 ${hour}:${minute.toString().padStart(2, '0')}`,
    };
  }

  // X分後 (テスト用)
  const inMinutesMatch = normalized.match(/(\d+)分後/);
  if (inMinutesMatch) {
    const minutesLater = parseInt(inMinutesMatch[1], 10);
    const now = new Date();
    const target = new Date(now.getTime() + minutesLater * 60 * 1000);
    return {
      success: true,
      cron_expression: `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`,
      human_readable: `${minutesLater}分後 (${target.getHours()}:${target.getMinutes().toString().padStart(2, '0')})`,
    };
  }

  // in X minutes (テスト用)
  const inMinutesEngMatch = normalized.match(/in\s+(\d+)\s+minutes?/);
  if (inMinutesEngMatch) {
    const minutesLater = parseInt(inMinutesEngMatch[1], 10);
    const now = new Date();
    const target = new Date(now.getTime() + minutesLater * 60 * 1000);
    return {
      success: true,
      cron_expression: `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`,
      human_readable: `In ${minutesLater} minute${minutesLater > 1 ? 's' : ''} (${target.getHours()}:${target.getMinutes().toString().padStart(2, '0')})`,
    };
  }

  // 明日X時 / 明日X時Y分 (一回限り)
  const tomorrowMatch = normalized.match(/明日\s*(\d{1,2})時(?:(\d{1,2})分)?/);
  if (tomorrowMatch) {
    const hour = parseInt(tomorrowMatch[1], 10);
    const minute = tomorrowMatch[2] ? parseInt(tomorrowMatch[2], 10) : 0;
    if (isValidTime(hour, minute)) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        success: true,
        cron_expression: `${minute} ${hour} ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`,
        human_readable: `明日 ${hour}:${minute.toString().padStart(2, '0')}`,
      };
    }
  }

  // tomorrow at TIME (一回限り)
  const tomorrowEngMatch = normalized.match(/tomorrow\s+(?:at\s+)?(.+)/);
  if (tomorrowEngMatch) {
    const time = parseTime(tomorrowEngMatch[1].trim());
    if (time) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        success: true,
        cron_expression: `${time[1]} ${time[0]} ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`,
        human_readable: `Tomorrow at ${time[0]}:${time[1].toString().padStart(2, '0')}`,
      };
    }
  }

  // 単純な時刻指定 "11:09" → 毎日11:09として解釈
  const simpleTimeColonMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (simpleTimeColonMatch) {
    const hour = parseInt(simpleTimeColonMatch[1], 10);
    const minute = parseInt(simpleTimeColonMatch[2], 10);
    if (isValidTime(hour, minute)) {
      return {
        success: true,
        cron_expression: `${minute} ${hour} * * *`,
        human_readable: `Every day at ${hour}:${minute.toString().padStart(2, '0')}`,
      };
    }
  }

  // 単純な日本語時刻 "9時" "9時30分" → 毎日として解釈
  const simpleJpTimeMatch = normalized.match(/^(\d{1,2})時(?:(\d{1,2})分)?$/);
  if (simpleJpTimeMatch) {
    const hour = parseInt(simpleJpTimeMatch[1], 10);
    const minute = simpleJpTimeMatch[2] ? parseInt(simpleJpTimeMatch[2], 10) : 0;
    if (isValidTime(hour, minute)) {
      return {
        success: true,
        cron_expression: `${minute} ${hour} * * *`,
        human_readable: `毎日 ${hour}:${minute.toString().padStart(2, '0')}`,
      };
    }
  }

  // X時間後 (一回限り)
  const inHoursMatch = normalized.match(/(\d+)時間後/);
  if (inHoursMatch) {
    const hoursLater = parseInt(inHoursMatch[1], 10);
    const now = new Date();
    const target = new Date(now.getTime() + hoursLater * 60 * 60 * 1000);
    return {
      success: true,
      cron_expression: `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`,
      human_readable: `${hoursLater}時間後 (${target.getHours()}:${target.getMinutes().toString().padStart(2, '0')})`,
    };
  }

  // in X hours (一回限り)
  const inHoursEngMatch = normalized.match(/in\s+(\d+)\s+hours?/);
  if (inHoursEngMatch) {
    const hoursLater = parseInt(inHoursEngMatch[1], 10);
    const now = new Date();
    const target = new Date(now.getTime() + hoursLater * 60 * 60 * 1000);
    return {
      success: true,
      cron_expression: `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`,
      human_readable: `In ${hoursLater} hour${hoursLater > 1 ? 's' : ''} (${target.getHours()}:${target.getMinutes().toString().padStart(2, '0')})`,
    };
  }

  return {
    success: false,
    error: `Could not parse schedule: "${input}". Try formats like "every day at 9:00", "毎日9時", "9:00", "9時", "every 5 minutes", or a cron expression.`,
  };
}

/**
 * 次回実行時刻を計算する
 */
export function getNextRunTime(cronExpression: string): Date | null {
  // シンプルな実装：node-cronのvalidateを使わず、基本的なパターンのみ対応
  const parts = cronExpression.split(' ');
  if (parts.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const now = new Date();

  // 毎分実行のパターン (* * * * *)
  if (minute === '*' && hour === '*') {
    const next = new Date(now);
    next.setMinutes(next.getMinutes() + 1);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  // 毎X分のパターン (*/X * * * *)
  const everyMinuteMatch = minute.match(/^\*\/(\d+)$/);
  if (everyMinuteMatch && hour === '*') {
    const interval = parseInt(everyMinuteMatch[1], 10);
    const next = new Date(now);
    const currentMinute = next.getMinutes();
    const nextMinute = Math.ceil((currentMinute + 1) / interval) * interval;
    if (nextMinute >= 60) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(nextMinute % 60);
    } else {
      next.setMinutes(nextMinute);
    }
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  // 毎時X分のパターン (X * * * *)
  const minuteNum = parseInt(minute, 10);
  if (!isNaN(minuteNum) && hour === '*') {
    const next = new Date(now);
    if (next.getMinutes() >= minuteNum) {
      next.setHours(next.getHours() + 1);
    }
    next.setMinutes(minuteNum);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  // 毎日X時Y分のパターン (Y X * * *)
  const hourNum = parseInt(hour, 10);
  if (!isNaN(minuteNum) && !isNaN(hourNum) && dayOfMonth === '*' && month === '*') {
    const next = new Date(now);
    next.setHours(hourNum);
    next.setMinutes(minuteNum);
    next.setSeconds(0);
    next.setMilliseconds(0);

    if (next <= now) {
      // 曜日指定がある場合
      if (dayOfWeek !== '*') {
        // 次の該当曜日を探す
        const targetDays = parseDayOfWeek(dayOfWeek);
        let daysToAdd = 1;
        for (let i = 1; i <= 7; i++) {
          const checkDate = new Date(next);
          checkDate.setDate(checkDate.getDate() + i);
          if (targetDays.includes(checkDate.getDay())) {
            daysToAdd = i;
            break;
          }
        }
        next.setDate(next.getDate() + daysToAdd);
      } else {
        next.setDate(next.getDate() + 1);
      }
    } else if (dayOfWeek !== '*') {
      // 今日だが曜日が一致するか確認
      const targetDays = parseDayOfWeek(dayOfWeek);
      if (!targetDays.includes(next.getDay())) {
        // 次の該当曜日を探す
        for (let i = 1; i <= 7; i++) {
          const checkDate = new Date(next);
          checkDate.setDate(checkDate.getDate() + i);
          if (targetDays.includes(checkDate.getDay())) {
            next.setDate(next.getDate() + i);
            break;
          }
        }
      }
    }

    return next;
  }

  // その他のパターンは一旦nullを返す
  return null;
}

/**
 * 曜日指定をパースする
 */
function parseDayOfWeek(dayOfWeek: string): number[] {
  const result: number[] = [];

  // 単一の数字
  if (/^\d$/.test(dayOfWeek)) {
    return [parseInt(dayOfWeek, 10)];
  }

  // 範囲 (1-5)
  const rangeMatch = dayOfWeek.match(/^(\d)-(\d)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    for (let i = start; i <= end; i++) {
      result.push(i);
    }
    return result;
  }

  // カンマ区切り (0,6)
  if (dayOfWeek.includes(',')) {
    return dayOfWeek.split(',').map(d => parseInt(d.trim(), 10));
  }

  return [0, 1, 2, 3, 4, 5, 6]; // デフォルトは全曜日
}
