import { parseSchedule, getNextRunTime } from '../src/parser';

describe('parseSchedule', () => {
  describe('cron expressions', () => {
    it('should pass through valid cron expressions', () => {
      const result = parseSchedule('0 9 * * *');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 9 * * *');
    });

    it('should pass through complex cron expressions', () => {
      const result = parseSchedule('*/5 * * * *');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('*/5 * * * *');
    });
  });

  describe('English patterns', () => {
    it('should parse "every 5 minutes"', () => {
      const result = parseSchedule('every 5 minutes');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('*/5 * * * *');
    });

    it('should parse "every hour"', () => {
      const result = parseSchedule('every hour');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 * * * *');
    });

    it('should parse "every 2 hours"', () => {
      const result = parseSchedule('every 2 hours');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 */2 * * *');
    });

    it('should parse "every day at 9:00"', () => {
      const result = parseSchedule('every day at 9:00');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 9 * * *');
    });

    it('should parse "daily at 21:30"', () => {
      const result = parseSchedule('daily at 21:30');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('30 21 * * *');
    });

    it('should parse "every day at 9am"', () => {
      const result = parseSchedule('every day at 9am');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 9 * * *');
    });

    it('should parse "every day at 9pm"', () => {
      const result = parseSchedule('every day at 9pm');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 21 * * *');
    });

    it('should parse "every monday at 10:00"', () => {
      const result = parseSchedule('every monday at 10:00');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 10 * * 1');
    });

    it('should parse "weekdays at 9:00"', () => {
      const result = parseSchedule('weekdays at 9:00');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 9 * * 1-5');
    });

    it('should parse "weekend at 18:00"', () => {
      const result = parseSchedule('weekend at 18:00');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 18 * * 0,6');
    });
  });

  describe('Japanese patterns', () => {
    it('should parse "5分ごと"', () => {
      const result = parseSchedule('5分ごと');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('*/5 * * * *');
    });

    it('should parse "5分毎"', () => {
      const result = parseSchedule('5分毎');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('*/5 * * * *');
    });

    it('should parse "毎日9時"', () => {
      const result = parseSchedule('毎日9時');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 9 * * *');
    });

    it('should parse "毎日9時30分"', () => {
      const result = parseSchedule('毎日9時30分');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('30 9 * * *');
    });

    it('should parse "平日9時"', () => {
      const result = parseSchedule('平日9時');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 9 * * 1-5');
    });

    it('should parse "週末18時"', () => {
      const result = parseSchedule('週末18時');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 18 * * 0,6');
    });
  });

  describe('simple time patterns', () => {
    it('should parse "11:09" as daily', () => {
      const result = parseSchedule('11:09');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('9 11 * * *');
    });

    it('should parse "9時" as daily', () => {
      const result = parseSchedule('9時');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('0 9 * * *');
    });

    it('should parse "21時30分" as daily', () => {
      const result = parseSchedule('21時30分');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toBe('30 21 * * *');
    });

    it('should parse "5分後" as one-time', () => {
      const result = parseSchedule('5分後');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toMatch(/^\d+ \d+ \d+ \d+ \*$/);
    });

    it('should parse "明日9時" as one-time', () => {
      const result = parseSchedule('明日9時');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toMatch(/^0 9 \d+ \d+ \*$/);
    });

    it('should parse "2時間後" as one-time', () => {
      const result = parseSchedule('2時間後');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toMatch(/^\d+ \d+ \d+ \d+ \*$/);
    });

    it('should parse "in 30 minutes" as one-time', () => {
      const result = parseSchedule('in 30 minutes');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toMatch(/^\d+ \d+ \d+ \d+ \*$/);
    });

    it('should parse "tomorrow at 9:00" as one-time', () => {
      const result = parseSchedule('tomorrow at 9:00');
      expect(result.success).toBe(true);
      expect(result.cron_expression).toMatch(/^0 9 \d+ \d+ \*$/);
    });
  });

  describe('time validation', () => {
    it('should reject invalid hour (25:00)', () => {
      const result = parseSchedule('every day at 25:00');
      expect(result.success).toBe(false);
    });

    it('should reject invalid minute (9:99)', () => {
      const result = parseSchedule('every day at 9:99');
      expect(result.success).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should return error for unparseable input', () => {
      const result = parseSchedule('random gibberish');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

describe('getNextRunTime', () => {
  it('should calculate next run for every minute pattern', () => {
    const nextRun = getNextRunTime('* * * * *');
    expect(nextRun).toBeInstanceOf(Date);
    expect(nextRun!.getTime()).toBeGreaterThan(Date.now());
  });

  it('should calculate next run for every 5 minutes', () => {
    const nextRun = getNextRunTime('*/5 * * * *');
    expect(nextRun).toBeInstanceOf(Date);
    expect(nextRun!.getMinutes() % 5).toBe(0);
  });

  it('should calculate next run for daily pattern', () => {
    const nextRun = getNextRunTime('0 9 * * *');
    expect(nextRun).toBeInstanceOf(Date);
    expect(nextRun!.getHours()).toBe(9);
    expect(nextRun!.getMinutes()).toBe(0);
  });

  it('should return null for invalid cron expression', () => {
    const nextRun = getNextRunTime('invalid');
    expect(nextRun).toBeNull();
  });
});
