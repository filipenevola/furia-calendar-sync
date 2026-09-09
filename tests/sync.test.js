import { test, expect } from 'bun:test';
import { load } from 'cheerio';
import { readFile } from 'node:fs/promises';
import { TEAMS, parseTeamPage, parseMatchPage, parseTimestamp, fetchHTML, fetchMatches } from '../src/retrieval/hltv.js';
import { processMatches, getMatchUniqueKey } from '../src/processing.js';
import { matchToCalendarEvent, parseCredentials, planCalendarSync, getExistingEvents, syncMatchesToCalendar } from '../src/calendar.js';
import { decodeCalendarId } from '../src/config.js';
import { sync } from '../src/sync.js';
const fixture = name => readFile(new URL(`fixtures/${name}.html`, import.meta.url), 'utf8');
const noSleep = async () => {};
const now = new Date('2026-09-08T00:00:00Z');
const example = { matchId: '2397604', source: 'hltv.org', date: new Date('2026-09-09T06:00:00Z'), team: 'MIBR', teamId: 9215, opponent: '9z', opponentId: 9996, competition: 'FISSURE Playground 3', format: 'MD3', url: 'https://www.hltv.org/matches/2397604/9z-vs-mibr-fissure-playground-3' };

for (const team of TEAMS) {
  test(`captured ${team.name} page and match detail agree on UTC, IDs, competition and BO`, async () => {
    const rows = parseTeamPage(await fixture(team.slug), team);
    expect(rows.length).toBe(1);
    const match = parseMatchPage(await fixture(`match-${rows[0].matchId}`), rows[0]);
    expect(match.team).toBe(team.name);
    expect(match.date.getTime()).toBe(rows[0].date.getTime());
    expect(match.competition.length).toBeGreaterThan(3);
    expect(match.format).toBe('MD3');
  });
}

test('timestamp is UTC milliseconds; never interpret human text or seconds', () => {
  expect(parseTimestamp('1788933600000').toISOString()).toBe('2026-09-09T06:00:00.000Z');
  for (const bad of ['', '1788933600', '09/09/2026', 'NaN', '-17889336000', '9999999999999']) expect(() => parseTimestamp(bad)).toThrow();
});
test('local display uses Campo Grande, not Sao Paulo or server timezone', () => {
  const event = matchToCalendarEvent(example);
  expect(event.start).toEqual({ dateTime: '2026-09-09T06:00:00.000Z', timeZone: 'America/Campo_Grande' });
  expect(event.description).toContain('02:00:00');
  expect(event.end.dateTime).toBe('2026-09-09T08:00:00.000Z');
  const midnight = matchToCalendarEvent({ ...example, date: new Date('2026-09-09T02:30:00Z') });
  expect(midnight.description).toContain('08/09/2026, 22:30:00');
});
test('wrong team and challenge/missing layout fail closed', async () => {
  expect(() => parseTeamPage('<title>Just a moment...</title>', TEAMS[0])).toThrow();
  expect(() => parseTeamPage('', TEAMS[0])).toThrow();
  expect(() => parseTeamPage(awaitedPain, TEAMS[0])).toThrow();
});
const awaitedPain = await fixture('pain');
test('explicit empty is allowed; silent selector break is not', () => {
  const prefix = '<div class="profile-team-name">FURIA</div><div id="matchesBox"><div class="headline-with-action"><h2>Upcoming matches for FURIA</h2></div>';
  expect(parseTeamPage(prefix + '<div class="empty-state">No upcoming matches for FURIA, check back later.</div></div>', TEAMS[0])).toEqual([]);
  expect(() => parseTeamPage(prefix + '</div>', TEAMS[0])).toThrow();
});
test('recent results are excluded even if they contain future timestamps', async () => {
  const html = await fixture('pain');
  const $ = load(html);
  const duplicateTable = $('table').toString().replaceAll('2397731', '9999999');
  $('#matchesBox').append('<h2>Recent results for paiN</h2>' + duplicateTable);
  expect(parseTeamPage($.html(), TEAMS[2])).toHaveLength(1);
});
test('malformed row fails rather than disappearing', async () => {
  expect(() => parseTeamPage(awaitedPain.replace('1788994800000', 'TBD'), TEAMS[2])).toThrow();
});
test('match details reject identity drift and skip explicitly postponed fixtures', async () => {
  const ref = parseTeamPage(await fixture('mibr'), TEAMS[3])[0];
  const html = await fixture(`match-${ref.matchId}`);
  expect(() => parseMatchPage(html.replace('/team/9215/', '/team/1/'), ref)).toThrow();
  expect(parseMatchPage(html.replace('Best of 3', 'Postponed. Best of 3'), ref)).toBeNull();
  expect(() => parseMatchPage(html.replace(/class="time"/g, 'class="changed"'), ref)).toThrow();
});
test('same match deduplicates but rematches in same competition remain separate', () => {
  expect(processMatches([example, { ...example }, { ...example, matchId: '2397605' }], now)).toHaveLength(2);
  expect(processMatches([{ ...example, date: now }], now)).toHaveLength(0);
  expect(() => processMatches([{ ...example, date: new Date('invalid') }], now)).toThrow();
  expect(getMatchUniqueKey(example)).toBe(getMatchUniqueKey({ ...example, date: new Date('2027-01-01') }));
  expect(() => processMatches([example, { ...example, date: new Date(+example.date + 60000) }], now)).toThrow();
});
test('derby uses canonical tracked side and one match id', async () => {
  const ref = parseTeamPage(await fixture('mibr'), TEAMS[3])[0];
  ref.teams = [{ id: 8297 }, { id: 9215 }];
  const html = (await fixture(`match-${ref.matchId}`)).replaceAll('/team/9996/9z', '/team/8297/furia').replaceAll('>9z<', '>FURIA<');
  const match = parseMatchPage(html, ref);
  expect(match.team).toBe('FURIA'); expect(match.opponent).toBe('MIBR');
  expect(processMatches([match, match], now)).toHaveLength(1);
});
test('one inaccessible team aborts retrieval before calendar writes', async () => {
  let writes = 0;
  await expect(sync({ retrieve: () => fetchMatches({ now, sleep: noSleep, fetchPage: async url => {
    if (url.includes('/8297/')) return fixture('furia');
    throw new Error('HLTV HTTP 403');
  } }), writeCalendar: async () => { writes++; } })).rejects.toThrow('403');
  expect(writes).toBe(0);
});
test('HTTP errors: bounded transient retry; no retry of access block or rate limit', async () => {
  let calls = 0;
  expect(await fetchHTML('https://www.hltv.org', { sleep: noSleep, fetchImpl: async () => { calls++; return new Response(calls < 3 ? '' : 'ok', { status: calls < 3 ? 503 : 200 }); } })).toBe('ok');
  expect(calls).toBe(3);
  for (const status of [403, 429]) {
    calls = 0;
    await expect(fetchHTML('https://www.hltv.org', { sleep: noSleep, fetchImpl: async () => { calls++; return new Response('', { status }); } })).rejects.toThrow(String(status));
    expect(calls).toBe(1);
  }
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
const managed = (fixtureId, id = 'old', date = example.date.toISOString()) => ({ id, start: { dateTime: date }, extendedProperties: { private: { furiaSync: 'true', fixtureId } } });
test('adopts legacy FURIA event in place and rejects ambiguous migration', () => {
  const match = { ...example, team: 'FURIA', teamId: 8297 };
  const old = managed('furia_vs_9z_old_competition');
  expect(planCalendarSync([match], [old])[0]).toMatchObject({ action: 'update', eventId: 'old', migrated: true });
  expect(() => planCalendarSync([match], [old, { ...old, id: 'other' }])).toThrow('Ambiguous');
  expect(() => planCalendarSync([match, { ...match, matchId: '2' }], [old])).toThrow('Two matches');
  expect(planCalendarSync([example], [old])[0].action).toBe('create');
});
test('HLTV event rescheduling is an update and repeated managed IDs fail', () => {
  expect(planCalendarSync([example], [managed('hltv_2397604')])[0].action).toBe('update');
  expect(() => planCalendarSync([example], [managed('hltv_2397604'), managed('hltv_2397604', 'other')])).toThrow('Duplicate');
});
test('reads every calendar page and ignores unrelated events', async () => {
  const calls = [];
  const calendar = { events: { list: async args => { calls.push(args); return { data: args.pageToken ? { items: [managed('hltv_2', 'second')] } : { items: [managed('hltv_1'), { id: 'unrelated' }], nextPageToken: 'page2' } }; } } };
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
    get: async () => ({ data: managed('hltv_2397604') }), patch: async () => { patches++; },
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

 test('live retrieval relies on all four team pages, not optional detail endpoints', async () => {
   const urls = [];
   const result = await fetchMatches({ now, sleep: noSleep, fetchPage: async url => {
     urls.push(url);
     const team = TEAMS.find(t => url.endsWith(`/${t.id}/${t.slug}`));
     if (!team) throw new Error('Detail endpoint must not be fetched');
     return fixture(team.slug);
   } });
   expect(urls).toHaveLength(4);
   expect(result.coverage.map(c => c.team)).toEqual(['FURIA', 'Legacy', 'paiN', 'MIBR']);
   expect(result.matches).toHaveLength(4);
   expect(result.matches.every(m => m.competition.length > 3 && m.format === '')).toBe(true);
 });

test('captured bracket placeholders have labels, not fabricated opponent IDs', async () => {
  for (const [team, label] of [[TEAMS[1], 'PARIVISION/FURIA winner'], [TEAMS[3], 'Astralis/BETBOOM winner']]) {
    const rows = parseTeamPage(await fixture(team.slug + '-pending'), team);
    expect(rows).toHaveLength(1);
    expect(rows[0].teams).toEqual([{ id: team.id, name: team.name }, { id: null, name: label }]);
    expect(rows[0].date.toISOString()).toBe('2026-09-10T09:00:00.000Z');
  }
});
test('unknown or broken linked opponents still fail closed', async () => {
  const html = await fixture('legacy-pending');
  expect(() => parseTeamPage(html.replaceAll('PARIVISION/FURIA winner', 'unrecognized'), TEAMS[1])).toThrow('Invalid HLTV team');
  expect(() => parseTeamPage(html.replace('<span class="team-name team-2">', '<a href="/broken" class="team-name team-2">'), TEAMS[1])).toThrow();
  for (const label of ['TBD', 'TBA', 'PARIVISION/FURIA loser']) {
    expect(parseTeamPage(html.replaceAll('PARIVISION/FURIA winner', label), TEAMS[1])[0].teams[1]).toEqual({ id: null, name: label });
  }
});
test('pending opponents do not block FURIA rescheduling; resolution updates the same event', async () => {
  const retrieved = await fetchMatches({ now, sleep: noSleep, fetchPage: async url => {
    const team = TEAMS.find(t => url.endsWith('/' + t.id + '/' + t.slug));
    return fixture(team.slug + ([12468, 9215].includes(team.id) ? '-pending' : ''));
  } });
  expect(retrieved.matches).toHaveLength(4);
  const pending = retrieved.matches.find(m => m.team === 'Legacy');
  const resource = matchToCalendarEvent(pending);
  expect(resource.summary).toBe('🎮 Legacy vs PARIVISION/FURIA winner');
  expect(resource.extendedProperties.private.teamIds).toBe('12468');
  const items = []; let inserts = 0; let patches = 0;
  const calendar = { events: {
    list: async () => ({ data: { items } }),
    insert: async ({ resource }) => { inserts++; items.push(resource); },
    patch: async ({ eventId, resource }) => { patches++; items[items.findIndex(e => e.id === eventId)] = { id: eventId, ...resource }; },
  } };
  await syncMatchesToCalendar(retrieved.matches, { calendar });
  const furia = retrieved.matches.find(m => m.team === 'FURIA');
  const moved = { ...furia, date: new Date(+furia.date + 55 * 60000) };
  await syncMatchesToCalendar([moved, { ...pending, opponent: 'FURIA', opponentId: 8297 }], { calendar });
  expect(inserts).toBe(4); expect(patches).toBe(2); expect(items).toHaveLength(4);
  expect(items.find(e => e.extendedProperties.private.fixtureId === getMatchUniqueKey(furia)).start.dateTime).toBe(moved.date.toISOString());
  expect(items.find(e => e.extendedProperties.private.fixtureId === getMatchUniqueKey(pending)).summary).toBe('🎮 Legacy vs FURIA');
});
test('conflicting pending opponent labels are not silently deduplicated', () => {
  const pending = { ...example, opponentId: null, opponent: 'A/B winner' };
  expect(() => processMatches([pending, { ...pending, opponent: 'C/D winner' }], now)).toThrow('Conflicting');
});

test('preserves Pager -n prefix while regenerating title and updating all other fields', () => {
  const changed = { ...example, opponent: 'FURIA', opponentId: 8297, date: new Date(+example.date + 55 * 60000) };
  for (const title of ['-n Old opponent', '  -n Old opponent', '-n', '-nOld opponent']) {
    const old = { ...managed('hltv_2397604'), summary: title };
    const entry = planCalendarSync([changed], [old])[0];
    expect(entry.resource).toEqual({ ...matchToCalendarEvent(changed), summary: '-n 🎮 MIBR vs FURIA (MD3)' });
    expect(entry.eventId).toBe('old');
  }
});
test('does not invent -n for new events or titles without the leading marker', () => {
  for (const title of [undefined, '', 'Old -n opponent', '🎮 MIBR vs 9z']) {
    expect(planCalendarSync([example], [{ ...managed('hltv_2397604'), summary: title }])[0].resource.summary)
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
  let item = { ...managed('hltv_2397604'), summary: '-n Old title' };
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
    get: async () => ({ data: { ...managed('hltv_2397604'), summary: '-n Old title' } }),
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
