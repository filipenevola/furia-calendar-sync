import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { TEAMS, BLOCK_RETRY_DELAY_MS, PARSE_INTERVAL_MS, USER_AGENT, parseTeamPage, parseTimestamp, fixtureKey, fetchPage, fetchMatches } from '../src/retrieval/liquipedia.js';
import { processMatches, getMatchUniqueKey } from '../src/processing.js';
import { matchToCalendarEvent, parseCredentials, planCalendarSync, getExistingEvents, syncMatchesToCalendar, summaryTeams } from '../src/calendar.js';
import { decodeCalendarId } from '../src/config.js';
import { sync } from '../src/sync.js';
const MIBR_TEAM = TEAMS.find(t => t.name === 'MIBR');
const fixture = async team => JSON.parse(await readFile(new URL(`fixtures/liquipedia-${team.page.toLowerCase()}.json`, import.meta.url), 'utf8'));
const withText = (payload, edit) => ({ parse: { ...payload.parse, text: edit(payload.parse.text) } });
const noSleep = async () => {};
const now = new Date('2026-09-08T00:00:00Z');
const example = { matchId: fixtureKey({ tournamentPath: '/counterstrike/FISSURE/Playground/3', stage: 'Group A', teams: ['MIBR', '9z'] }), source: 'liquipedia.net', date: new Date('2026-09-09T06:00:00Z'), team: 'MIBR', teamId: null, opponent: '9z', opponentId: null, competition: 'FISSURE Playground 3', format: 'MD3', url: 'https://liquipedia.net/counterstrike/FISSURE/Playground/3' };
const KEY = getMatchUniqueKey(example);

test('captured team pages: UTC seconds, tournament, stage and one derby key', async () => {
  const [furia, legacy] = await Promise.all(TEAMS.slice(0, 2).map(async t => parseTeamPage(await fixture(t), t)));
  expect(furia).toEqual([{
    matchId: legacy[0].matchId, url: 'https://liquipedia.net/counterstrike/Thunderpick/World_Championship/2026#Group_B',
    competition: "Thunderpick World Champ. '26 - Group B - Winners Match", date: new Date('2026-10-15T16:00:00Z'), teams: ['FURIA', 'Legacy'],
  }]);
  const mibr = parseTeamPage(await fixture(MIBR_TEAM), MIBR_TEAM);
  expect(mibr[0]).toMatchObject({ teams: ['MIBR', 'BC.Game'], competition: 'Stake Pulse Beat III - Group D - Opening Matches' });
});
test('timestamp is UTC seconds; never interpret human text or milliseconds', () => {
  expect(parseTimestamp('1788933600').toISOString()).toBe('2026-09-09T06:00:00.000Z');
  for (const bad of ['', '1788933600000', '09/09/2026', 'NaN', '-178893360', '9999999999']) expect(() => parseTimestamp(bad)).toThrow();
});
test('local display uses Campo Grande, not Sao Paulo or server timezone', () => {
  const event = matchToCalendarEvent(example);
  expect(event.start).toEqual({ dateTime: '2026-09-09T06:00:00.000Z', timeZone: 'America/Campo_Grande' });
  expect(event.description).toContain('02:00:00');
  expect(event.end.dateTime).toBe('2026-09-09T08:00:00.000Z');
  const midnight = matchToCalendarEvent({ ...example, date: new Date('2026-09-09T02:30:00Z') });
  expect(midnight.description).toContain('08/09/2026, 22:30:00');
});
test('wrong page, missing infobox or broken match fail closed', async () => {
  const furia = await fixture(TEAMS[0]);
  expect(() => parseTeamPage(furia, TEAMS[1])).toThrow('identity');
  expect(() => parseTeamPage({}, TEAMS[0])).toThrow();
  expect(() => parseTeamPage(withText(furia, t => t.replace('fo-nttax-infobox', 'changed')), TEAMS[0])).toThrow('layout');
  expect(() => parseTeamPage(withText(furia, t => t.replace('1792080000', 'TBD')), TEAMS[0])).toThrow('timestamp');
  expect(() => parseTeamPage(withText(furia, t => t.replace('class="carousel-item"', 'class="changed"')), TEAMS[0])).toThrow('Unrecognized');
  expect(() => parseTeamPage(withText(furia, t => t.replace('match-info-tournament-name', 'changed')), TEAMS[0])).toThrow('tournament');
  expect(() => parseTeamPage(withText(furia, t => t.replaceAll('>Legacy<', '><')), TEAMS[0])).toThrow('Invalid');
});
test('no upcoming section is an empty schedule; placeholders keep their label', async () => {
  const furia = await fixture(TEAMS[0]);
  expect(parseTeamPage(withText(furia, t => t.slice(0, t.indexOf('<div class="mw-heading')) + '</div>'), TEAMS[0])).toEqual([]);
  expect(parseTeamPage(withText(furia, t => t.replaceAll('>Legacy<', '>TBD<')), TEAMS[0])[0].teams).toEqual(['FURIA', 'TBD']);
});
test('same match deduplicates but rematches in same competition remain separate', () => {
  expect(processMatches([example, { ...example }, { ...example, matchId: fixtureKey({ tournamentPath: 'x', stage: '', teams: ['MIBR', '9z'] }) }], now)).toHaveLength(2);
  expect(processMatches([{ ...example, date: now }], now)).toHaveLength(0);
  expect(() => processMatches([{ ...example, date: new Date('invalid') }], now)).toThrow();
  expect(getMatchUniqueKey(example)).toBe(getMatchUniqueKey({ ...example, date: new Date('2027-01-01') }));
  expect(() => getMatchUniqueKey({ ...example, source: 'hltv.org' })).toThrow('identity');
  expect(() => processMatches([example, { ...example, date: new Date(+example.date + 60000) }], now)).toThrow();
});
const fixturePages = async team => fixture(team);
test('derby listed by both teams becomes one match on the canonical side', async () => {
  const result = await fetchMatches({ now: new Date('2026-10-15T00:00:00Z'), sleep: noSleep, fetchTeam: fixturePages });
  expect(result.coverage.map(c => c.team)).toEqual(['FURIA', 'Legacy', 'MIBR']);
  expect(result.matches.map(m => `${m.team} vs ${m.opponent}`)).toEqual(['FURIA vs Legacy', 'MIBR vs BC.Game']);
  expect(result.matches.every(m => m.source === 'liquipedia.net' && m.format === '')).toBe(true);
});
test('team pages respect the Liquipedia parse rate limit', async () => {
  const sleeps = [];
  await fetchMatches({ now, sleep: async ms => { sleeps.push(ms); }, fetchTeam: fixturePages });
  expect(sleeps).toEqual([PARSE_INTERVAL_MS, PARSE_INTERVAL_MS]);
  expect(PARSE_INTERVAL_MS).toBeGreaterThanOrEqual(30000);
});
test('one inaccessible team aborts retrieval before calendar writes', async () => {
  let writes = 0;
  await expect(sync({ retrieve: () => fetchMatches({ now, sleep: noSleep, fetchTeam: async team => {
    if (team.name === 'FURIA') return fixture(team);
    throw new Error('Liquipedia HTTP 404: Legacy');
  } }), writeCalendar: async () => { writes++; } })).rejects.toThrow('404');
  expect(writes).toBe(0);
});
test('paiN is not synced', () => {
  expect(TEAMS.map(t => t.name)).toEqual(['FURIA', 'Legacy', 'MIBR']);
});
test('a blocked team page is retried once after a pause and the run continues', async () => {
  const sleeps = []; const calls = {};
  const result = await fetchMatches({ now, sleep: async ms => { sleeps.push(ms); }, fetchTeam: async team => {
    calls[team.name] = (calls[team.name] || 0) + 1;
    if (team.name === 'Legacy' && calls.Legacy === 1) throw Object.assign(new Error('Liquipedia HTTP 429: Legacy'), { blocked: true });
    return fixture(team);
  } });
  expect(calls).toEqual({ FURIA: 1, Legacy: 2, MIBR: 1 });
  expect(sleeps).toContain(BLOCK_RETRY_DELAY_MS);
  expect(result.blocks).toEqual([{ team: 'Legacy', message: 'Liquipedia HTTP 429: Legacy' }]);
});
test('a persistent block skips the run without touching the Calendar', async () => {
  let writes = 0; let fetches = 0;
  const result = await sync({ retrieve: () => fetchMatches({ now, sleep: noSleep, fetchTeam: async team => {
    fetches++;
    if (team.name === 'FURIA') return fixture(team);
    throw Object.assign(new Error('Liquipedia HTTP 429: Legacy'), { blocked: true });
  } }), writeCalendar: async () => { writes++; } });
  expect(result).toMatchObject({ status: 'skipped', calendar: 'untouched' });
  expect(result.reason).toContain('429');
  expect(fetches).toBe(3);
  expect(writes).toBe(0);
});
test('HTTP errors: identifying User-Agent, bounded transient retry, no retry of a rate limit', async () => {
  let calls = 0; let headers;
  const ok = new Response(JSON.stringify({ parse: { title: 'FURIA' } }));
  expect(await fetchPage(TEAMS[0], { sleep: noSleep, fetchImpl: async (url, init) => { calls++; headers = init.headers; return calls < 3 ? new Response('', { status: 503 }) : ok; } })).toEqual({ parse: { title: 'FURIA' } });
  expect(calls).toBe(3);
  expect(headers['User-Agent']).toBe(USER_AGENT);
  for (const status of [403, 429]) {
    calls = 0;
    const error = await fetchPage(TEAMS[0], { sleep: noSleep, fetchImpl: async () => { calls++; return new Response('', { status }); } }).catch(e => e);
    expect(error.message).toContain(String(status));
    expect(error.blocked).toBe(true);
    expect(calls).toBe(1);
  }
  calls = 0;
  const limited = await fetchPage(TEAMS[0], { sleep: noSleep, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: { code: 'ratelimited' } })); } }).catch(e => e);
  expect(limited.blocked).toBe(true); expect(calls).toBe(1);
  const missing = await fetchPage(TEAMS[0], { sleep: noSleep, fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'missingtitle' } })) }).catch(e => e);
  expect(missing.message).toContain('missingtitle'); expect(missing.blocked).toBeUndefined();
});
test('calendar ID accepts raw email and unpadded base64 without corrupting either', () => {
  expect(decodeCalendarId('test@example.com')).toBe('test@example.com');
  expect(decodeCalendarId(Buffer.from('test@example.com').toString('base64').replace(/=+$/, ''))).toBe('test@example.com');
  expect(decodeCalendarId('opaque-id')).toBe('opaque-id');
});
test('invalid credentials errors do not leak input', () => {
  expect(() => parseCredentials('private-secret-value')).toThrow('must be service-account JSON');
  expect(() => parseCredentials(null)).toThrow('required');
});
const managed = (fixtureId, id = 'old', date = example.date.toISOString(), summary) => ({ id, summary, start: { dateTime: date }, extendedProperties: { private: { furiaSync: 'true', fixtureId } } });
test('adopts legacy FURIA event in place and rejects ambiguous migration', () => {
  const match = { ...example, team: 'FURIA', teamId: 8297 };
  const old = managed('furia_vs_9z_old_competition');
  expect(planCalendarSync([match], [old])[0]).toMatchObject({ action: 'update', eventId: 'old', migrated: true });
  expect(() => planCalendarSync([match], [old, { ...old, id: 'other' }])).toThrow('Ambiguous');
  expect(() => planCalendarSync([match, { ...match, matchId: fixtureKey({ tournamentPath: 'x', stage: '', teams: ['FURIA', '9z'] }) }], [old])).toThrow('Two matches');
  expect(planCalendarSync([example], [old])[0].action).toBe('create');
});
test('event rescheduling is an update and repeated managed IDs fail', () => {
  expect(planCalendarSync([example], [managed(KEY)])[0].action).toBe('update');
  expect(() => planCalendarSync([example], [managed(KEY), managed(KEY, 'other')])).toThrow('Duplicate');
});
test('reads every calendar page and ignores unrelated events', async () => {
  const calls = [];
  const calendar = { events: { list: async args => { calls.push(args); return { data: args.pageToken ? { items: [managed('lp_2', 'second')] } : { items: [managed('lp_1'), { id: 'unrelated' }], nextPageToken: 'page2' } }; } } };
  expect(await getExistingEvents(calendar, 'test')).toHaveLength(2);
  expect(calls[1].pageToken).toBe('page2');
  expect(calls[0].privateExtendedProperty).toEqual(['furiaSync=true']);
});
test('dry-run has zero inserts/patches, repeated real runs are idempotent', async () => {
  const items = []; let inserts = 0; let patches = 0;
  const calendar = { events: {
    list: async () => ({ data: { items } }),
    insert: async ({ resource }) => { inserts++; items.push(resource); },
    patch: async ({ eventId, resource }) => { patches++; items[items.findIndex(e => e.id === eventId)] = { id: eventId, ...resource }; },
  } };
  await syncMatchesToCalendar([example], { calendar, dryRun: true });
  expect(inserts + patches).toBe(0);
  await syncMatchesToCalendar([example], { calendar });
  await syncMatchesToCalendar([{ ...example, date: new Date(+example.date + 3600000) }], { calendar });
  expect(inserts).toBe(1); expect(patches).toBe(1); expect(items).toHaveLength(1);
});
test('insert 409 recovers known managed event; unrelated collision and write error fail job', async () => {
  let patches = 0;
  const calendar = { events: {
    list: async () => ({ data: {} }), insert: async () => { throw { code: 409 }; },
    get: async () => ({ data: managed(KEY) }), patch: async () => { patches++; },
  } };
  await syncMatchesToCalendar([example], { calendar }); expect(patches).toBe(1);
  calendar.events.get = async () => ({ data: { id: 'unrelated' } });
  await expect(syncMatchesToCalendar([example], { calendar })).rejects.toThrow('collision');
  calendar.events.insert = async () => { throw new Error('Calendar unavailable'); };
  await expect(syncMatchesToCalendar([example], { calendar })).rejects.toThrow('unavailable');
});
test('source-only dry run never touches calendar and write failures propagate', async () => {
  const retrieve = async () => ({ matches: [example], coverage: [], unscheduled: [] });
  const writeCalendar = async () => { throw new Error('write failure'); };
  expect((await sync({ retrieve, writeCalendar, dryRun: true })).dryRun).toBe(true);
  await expect(sync({ retrieve, writeCalendar })).rejects.toThrow('write failure');
});

test('preserves Pager -n prefix while regenerating title and updating all other fields', () => {
  const changed = { ...example, opponent: 'FURIA', opponentId: 8297, date: new Date(+example.date + 55 * 60000) };
  for (const title of ['-n Old opponent', '  -n Old opponent', '-n', '-nOld opponent']) {
    const old = { ...managed(KEY), summary: title };
    const entry = planCalendarSync([changed], [old])[0];
    expect(entry.resource).toEqual({ ...matchToCalendarEvent(changed), summary: '-n 🎮 MIBR vs FURIA (MD3)' });
    expect(entry.eventId).toBe('old');
  }
});
test('does not invent -n for new events or titles without the leading marker', () => {
  for (const title of [undefined, '', 'Old -n opponent', '🎮 MIBR vs 9z']) {
    expect(planCalendarSync([example], [{ ...managed(KEY), summary: title }])[0].resource.summary)
      .toBe('🎮 MIBR vs 9z (MD3)');
  }
  expect(planCalendarSync([example], [])[0].resource.summary).toBe('🎮 MIBR vs 9z (MD3)');
});
test('legacy adoption also preserves the no-alarm prefix', () => {
  const match = { ...example, team: 'FURIA', teamId: 8297 };
  const old = { ...managed('furia_vs_9z_old_competition'), summary: '-n Old title' };
  expect(planCalendarSync([match], [old])[0]).toMatchObject({
    action: 'update', eventId: 'old', migrated: true, resource: { summary: '-n 🎮 FURIA vs 9z (MD3)' },
  });
});
test('dry-run and repeat writes retain one -n; user removal is respected', async () => {
  let item = { ...managed(KEY), summary: '-n Old title' };
  let patches = 0;
  const calendar = { events: {
    list: async () => ({ data: { items: [item] } }),
    patch: async ({ eventId, resource }) => { patches++; item = { id: eventId, ...resource }; },
  } };
  const dry = await syncMatchesToCalendar([example], { calendar, dryRun: true });
  expect(dry.planned[0].summary).toBe('-n 🎮 MIBR vs 9z (MD3)');
  expect(patches).toBe(0);
  for (let i = 0; i < 3; i++) await syncMatchesToCalendar([example], { calendar });
  expect(item.summary).toBe('-n 🎮 MIBR vs 9z (MD3)');
  expect(patches).toBe(3);
  item.summary = '🎮 MIBR vs 9z (MD3)';
  await syncMatchesToCalendar([example], { calendar });
  expect(item.summary).toBe('🎮 MIBR vs 9z (MD3)');
});
test('insert conflict recovery preserves the prefix on the existing remote event', async () => {
  let written;
  const calendar = { events: {
    list: async () => ({ data: { items: [] } }),
    insert: async () => { throw { code: 409 }; },
    get: async () => ({ data: { ...managed(KEY), summary: '-n Old title' } }),
    patch: async ({ resource }) => { written = resource; },
  } };
  const result = await syncMatchesToCalendar([example], { calendar });
  expect(written.summary).toBe('-n 🎮 MIBR vs 9z (MD3)');
  expect(result.planned[0].summary).toBe(written.summary);
  expect(result.updated).toBe(1);
});
test('calendar verifier expected title recognizes preserved -n', () => {
  expect(matchToCalendarEvent(example, '-n old').summary).toBe('-n 🎮 MIBR vs 9z (MD3)');
  expect(matchToCalendarEvent(example).summary).toBe('🎮 MIBR vs 9z (MD3)');
});

test('existing HLTV events are adopted in place, never duplicated', () => {
  const hltv = (summary, date = example.date.toISOString(), id = 'hltv-event') => managed('hltv_2399386', id, date, summary);
  for (const title of ['🎮 MIBR vs 9z', '-n 🎮 9Z vs MIBR (MD3)', '🎮 MIBR vs FURIA/9z winner', '🎮 MIBR vs TBD']) {
    expect(planCalendarSync([example], [hltv(title)])[0]).toMatchObject({ action: 'update', eventId: 'hltv-event', migrated: true });
  }
  expect(planCalendarSync([example], [hltv('-n 🎮 MIBR vs 9z')])[0].resource.summary).toBe('-n 🎮 MIBR vs 9z (MD3)');
  expect(planCalendarSync([{ ...example, opponent: 'TBD' }], [hltv('🎮 MIBR vs 9z')])[0].action).toBe('update');
  // Different opponent, other tracked team, or more than six hours away is a different match.
  expect(planCalendarSync([example], [hltv('🎮 MIBR vs MOUZ')])[0].action).toBe('create');
  expect(planCalendarSync([example], [hltv('🎮 FURIA vs 9z')])[0].action).toBe('create');
  expect(planCalendarSync([example], [hltv('🎮 MIBR vs 9z', new Date(+example.date + 7 * 3600000).toISOString())])[0].action).toBe('create');
  expect(() => planCalendarSync([example], [hltv('🎮 MIBR vs 9z'), hltv('🎮 MIBR vs TBD', undefined, 'other')])).toThrow('Ambiguous');
  // An event already owned by a current fixture is never taken by another match.
  const other = { ...example, matchId: fixtureKey({ tournamentPath: 'y', stage: '', teams: ['MIBR', '9z'] }) };
  expect(planCalendarSync([example, other], [managed(KEY, 'owned', undefined, '🎮 MIBR vs 9z')]).map(p => p.action)).toEqual(['update', 'create']);
  expect(summaryTeams('Lunch')).toBeNull();
});
test('adopted HLTV event is rewritten with the Liquipedia key; the next run is an exact update', async () => {
  const items = [managed('hltv_2399386', 'hltv-event', undefined, '🎮 MIBR vs 9z')]; let inserts = 0;
  const calendar = { events: {
    list: async () => ({ data: { items } }), insert: async () => { inserts++; },
    patch: async ({ eventId, resource }) => { items[items.findIndex(e => e.id === eventId)] = { id: eventId, ...resource }; },
  } };
  expect((await syncMatchesToCalendar([example], { calendar })).migrated).toBe(1);
  expect(items[0].extendedProperties.private).toMatchObject({ fixtureId: KEY, source: 'liquipedia.net' });
  expect((await syncMatchesToCalendar([example], { calendar })).migrated).toBe(0);
  expect(inserts).toBe(0); expect(items).toHaveLength(1);
});
