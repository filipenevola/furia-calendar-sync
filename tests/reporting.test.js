import { test, expect } from 'bun:test';
import { fingerprint, workRequest, reportToFactory } from '../src/factory.js';
import { recordBlockedRun, recordSuccessfulRun, STATE_EVENT_ID } from '../src/block-streak.js';

test('fingerprint groups the same failure class and ignores volatile IDs and URLs', () => {
  expect(fingerprint('Conflicting HLTV team pages for 2399386; retry next run'))
    .toBe(fingerprint('Conflicting HLTV team pages for 2400001; retry next run'));
  expect(fingerprint('HLTV HTTP 500: https://www.hltv.org/team/8297/furia'))
    .toBe(fingerprint('HLTV HTTP 502: https://www.hltv.org/team/12468/legacy'));
  expect(fingerprint('Missing upcoming section for FURIA')).not.toBe(fingerprint('Missing upcoming section for MIBR'));
  expect(fingerprint('x').length).toBeLessThanOrEqual(200);
});

test('work request matches the work controller intake contract', () => {
  const body = workRequest(new Error('Missing upcoming section for FURIA'));
  expect(body).toMatchObject({ type: 'bug', repository: 'filipenevola/furia-calendar-sync', source: 'br-cs-calendar-sync-job' });
  expect(body.source).toMatch(/^[\w.-]{1,80}$/);
  expect(body.title.length).toBeLessThanOrEqual(250);
  expect(body.links.every(l => l.startsWith('https://'))).toBe(true);
  expect(Object.keys(body.context).every(k => ['message', 'stack', 'environment'].includes(k))).toBe(true);
  expect(workRequest(new Error('a')).externalId).not.toBe(workRequest(new Error('a')).externalId);
});

test('reportToFactory posts with the bearer and never throws', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return Response.json({ work: { id: 'work_1' }, duplicate: true }, { status: 200 }); };
  const env = { FACTORY_WORK_BEARER: 'token', FACTORY_WORK_URL: 'https://factory.test' };
  expect(await reportToFactory(new Error('boom'), { fetchImpl, env })).toEqual({ reported: true, workId: 'work_1', duplicate: true });
  expect(calls[0].url).toBe('https://factory.test/work');
  expect(calls[0].init.headers.authorization).toBe('Bearer token');
  expect(JSON.parse(calls[0].init.body).context.message).toBe('boom');

  expect(await reportToFactory(new Error('boom'), { fetchImpl, env: {} })).toMatchObject({ reported: false });
  expect(await reportToFactory(new Error('boom'), { env, fetchImpl: async () => new Response('', { status: 401 }) }))
    .toEqual({ reported: false, reason: 'work controller HTTP 401' });
  expect(await reportToFactory(new Error('boom'), { env, fetchImpl: async () => { throw new Error('ECONNRESET'); } }))
    .toEqual({ reported: false, reason: 'ECONNRESET' });
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
