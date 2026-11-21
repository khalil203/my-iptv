import test from 'node:test';
import assert from 'node:assert/strict';
import { TIME_ZONES, timezoneOffsetLabel, zonedDayAndMinute } from '../public/timezones.js';

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
