import { test, expect } from 'bun:test';
import { t3Request } from '../src/t3.js';
import { recordBlockedRun, recordSuccessfulRun, STATE_EVENT_ID } from '../src/block-streak.js';

test('t3Request mentions t3fn on this repository only when configured', () => {
  expect(t3Request('boom', {})).toBe('boom');
  const text = t3Request('boom', { T3_SLACK_BOT_USER_ID: 'U123' });
  expect(text.startsWith('<@U123> [furia-calendar-sync] boom')).toBe(true);
});

function fakeCalendar() {
  const store = new Map();
  const calls = { insert: 0, patch: 0 };
  return {
    store, calls,
    events: {
      get: async ({ calendarId, eventId }) => {
        if (!store.has(`${calendarId}/${eventId}`)) throw Object.assign(new Error('Not Found'), { code: 404 });
        return { data: store.get(`${calendarId}/${eventId}`) };
      },
      insert: async ({ calendarId, resource }) => { calls.insert++; store.set(`${calendarId}/${resource.id}`, resource); },
      patch: async ({ calendarId, eventId, resource }) => { calls.patch++; store.set(`${calendarId}/${eventId}`, resource); },
    },
  };
}

test('block streak stays silent until every 10th consecutive blocked run', async () => {
  const calendar = fakeCalendar();
  const notified = [];
  for (let run = 1; run <= 25; run++) {
    const { streak, notify } = await recordBlockedRun(calendar, 10);
    expect(streak).toBe(run);
    if (notify) notified.push(streak);
  }
  expect(notified).toEqual([10, 20]);
  // State lives only on the service account's own calendar.
  expect([...calendar.store.keys()]).toEqual([`primary/${STATE_EVENT_ID}`]);
  expect(calendar.calls.insert).toBe(1);
});

test('a successful run resets the streak and writes only when one was open', async () => {
  const calendar = fakeCalendar();
  expect(await recordSuccessfulRun(calendar)).toEqual({ previousStreak: 0 });
  expect(calendar.calls.insert + calendar.calls.patch).toBe(0);
  for (let run = 0; run < 9; run++) await recordBlockedRun(calendar, 10);
  expect(await recordSuccessfulRun(calendar)).toEqual({ previousStreak: 9 });
  expect((await recordBlockedRun(calendar, 10)).streak).toBe(1);
});
