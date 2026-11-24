import test from 'node:test';
import assert from 'node:assert/strict';
import { TIME_ZONES, timezoneOffsetLabel, zonedDayAndMinute, localMinuteToUtc, shiftRangeUtc, formatInZone } from '../public/timezones.js';

test('timezone catalog includes all valid IANA IDs, aliases, and UTC', () => {
  assert.ok(TIME_ZONES.length >= 590);
  assert.ok(TIME_ZONES.includes('UTC'));
  assert.ok(TIME_ZONES.includes('Asia/Bangkok'));
  assert.ok(TIME_ZONES.includes('Asia/Kathmandu'));
  assert.ok(TIME_ZONES.includes('US/Eastern'));
  assert.ok(TIME_ZONES.includes('America/New_York'));
  assert.ok(TIME_ZONES.includes('Pacific/Chatham'));
  if (typeof Intl.supportedValuesOf === 'function') {
    for (const zone of Intl.supportedValuesOf('timeZone')) assert.ok(TIME_ZONES.includes(zone), `missing ${zone}`);
  }
});

test('zone option offset reflects daylight saving and non-hour offsets', () => {
  assert.equal(timezoneOffsetLabel('Pacific/Chatham', Date.UTC(2024, 0, 1, 12)), 'UTC+13:45');
  assert.equal(timezoneOffsetLabel('Pacific/Chatham', Date.UTC(2024, 6, 1, 12)), 'UTC+12:45');
  assert.equal(timezoneOffsetLabel('UTC', Date.UTC(2024, 0, 1)), 'UTC');
});

test('zoned shift time uses the agent zone across calendar-day boundaries', () => {
  const instant = Date.UTC(2024, 0, 1, 12);
  assert.deepEqual(zonedDayAndMinute(instant, 'Pacific/Kiritimati'), { day: 2, minute: 120 });
  assert.deepEqual(zonedDayAndMinute(instant, 'America/Los_Angeles'), { day: 1, minute: 240 });
});

test('UTC conversion renders MANO and Khalil schedules in any viewer zone', () => {
  const tech = shiftRangeUtc({ start: 14 * 60, end: 21 * 60 }, '2026-11-24', 'Asia/Bangkok');
  assert.equal(tech.start, Date.UTC(2026, 10, 24, 7));
  assert.equal(formatInZone(tech.start, 'Europe/Madrid', { hour: '2-digit', minute: '2-digit' }), '08:00');

  const support = shiftRangeUtc({ start: 15 * 60 + 15, end: 22 * 60 }, '2026-11-24', 'Europe/Madrid');
  assert.equal(support.start, Date.UTC(2026, 10, 24, 14, 15));
  assert.equal(support.end, Date.UTC(2026, 10, 24, 21));
  assert.equal(formatInZone(support.start, 'Asia/Bangkok', { hour: '2-digit', minute: '2-digit' }), '21:15');
  assert.match(formatInZone(support.end, 'Asia/Bangkok', { hour: '2-digit', minute: '2-digit', day: '2-digit' }), /25.*04:00/);

  assert.equal(localMinuteToUtc('2026-07-24', 15 * 60 + 15, 'Europe/Madrid'), Date.UTC(2026, 6, 24, 13, 15), 'daylight saving is applied');
});
