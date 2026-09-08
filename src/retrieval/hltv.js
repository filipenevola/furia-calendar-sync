import { load } from 'cheerio';

export const TEAMS = Object.freeze([
  { id: 8297, name: 'FURIA', slug: 'furia' },
  { id: 12468, name: 'Legacy', slug: 'legacy' },
  { id: 4773, name: 'paiN', slug: 'pain' },
  { id: 9215, name: 'MIBR', slug: 'mibr' },
]);
const ORIGIN = 'https://www.hltv.org';
const clean = value => value.replace(/\s+/g, ' ').trim();

export function parseTimestamp(value) {
  // HLTV data-unix is UTC milliseconds, NOT the displayed browser-local time.
  if (!/^\d{13}$/.test(value || '') || +value < 946684800000 || +value > 4102444800000) {
    throw new Error(`Invalid HLTV UTC millisecond timestamp: ${value}`);
  }
  return new Date(+value);
}

function document(html) {
  const $ = load(html);
  if (/Just a moment|Access denied|Attention Required/i.test($('title').text())) {
    throw new Error('HLTV returned an access challenge; refusing an empty successful sync');
  }
  return $;
}

export function parseTeamPage(html, team) {
  const $ = document(html);
  if (clean($('.profile-team-name').text()) !== team.name || !$('#matchesBox').length) {
    throw new Error(`HLTV team identity/layout mismatch for ${team.name} (${team.id})`);
  }
  const heading = $('#matchesBox .headline-with-action').filter((_, el) =>
    clean($(el).text()) === `Upcoming matches for ${team.name}`);
  if (heading.length !== 1) throw new Error(`Missing upcoming section for ${team.name}`);
  const section = heading.nextUntil('h2');
  const table = section.filter('table.match-table');
  const links = table.find('a.matchpage-button');
  if (!links.length) {
    if (section.filter('.empty-state').text().includes(`No upcoming matches for ${team.name}`)) return [];
    throw new Error(`Unrecognized empty upcoming section for ${team.name}`);
  }
  if (table.find('tr.team-row').length !== links.length) throw new Error('Incomplete HLTV match rows');
  return links.toArray().map(el => {
    const row = $(el).closest('tr');
    const path = $(el).attr('href');
    const matchId = path?.match(/^\/matches\/(\d+)\/[a-z0-9-]+$/)?.[1];
    const teams = row.find('a.team-name').toArray().map(t => ({
      id: Number($(t).attr('href')?.match(/^\/team\/(\d+)\//)?.[1]), name: clean($(t).text()),
    }));
    if (!matchId || teams.length !== 2 || !teams.some(t => t.id === team.id) || teams.some(t => !t.id || !t.name)) {
      throw new Error(`Invalid HLTV match row for ${team.name}`);
    }
    const competition = clean(row.closest('tbody').prevAll('thead').first().find('.event-header-cell a').text());
    if (!competition) throw new Error(`Missing tournament for ${matchId}`);
    return { matchId, url: ORIGIN + path, competition, date: parseTimestamp(row.find('[data-unix]').first().attr('data-unix')), teams };
  });
}

export function parseMatchPage(html, reference) {
  const $ = document(html);
  const box = $('.teamsBox');
  const teams = ['.team1-gradient', '.team2-gradient'].map(selector => {
    const a = box.find(`${selector} a`).first();
    return { id: Number(a.attr('href')?.match(/^\/team\/(\d+)\//)?.[1]), name: clean(a.find('.teamName').text()) };
  });
  if (teams.some(t => !t.id || !t.name) || !reference.teams.every(t => teams.some(actual => actual.id === t.id))) {
    throw new Error(`HLTV match identity mismatch: ${reference.matchId}`);
  }
  const notes = clean($('.preformatted-text').first().text());
  const status = clean(box.find('.countdown').text());
  if (/postponed|cancelled|canceled|time tba|time tbd/i.test(`${status} ${notes}`)) return null;
  const date = parseTimestamp(box.find('.time[data-unix]').attr('data-unix'));
  const competition = clean(box.find('.event a').text());
  const bestOf = notes.match(/Best of (\d+)/i)?.[1];
  if (!competition || !bestOf) throw new Error(`Incomplete HLTV match details: ${reference.matchId}`);
  // Canonical tracked side independent of which team's page discovered a derby.
  const team = TEAMS.find(tracked => teams.some(t => t.id === tracked.id));
  if (!team) throw new Error(`Match has no tracked team: ${reference.matchId}`);
  const opponent = teams.find(t => t.id !== team.id);
  return {
    matchId: reference.matchId, date, team: team.name, teamId: team.id,
    opponent: opponent.name, opponentId: opponent.id,
    competition, format: `MD${bestOf}`, location: /\(LAN\)/i.test(notes) ? 'LAN' : /\(Online\)/i.test(notes) ? 'Online' : '',
    broadcast: '', source: 'hltv.org', url: reference.url,
  };
}

export async function fetchHTML(url, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        const error = new Error(`HLTV HTTP ${response.status}: ${url}`);
        error.noRetry = response.status < 500;
        throw error;
      }
      const html = await response.text();
      if (!html || html.length > 15_000_000) throw new Error('Invalid HLTV response size');
      return html;
    } catch (error) {
      // Do not try to bypass access challenges/rate limits. Retry only transient failures.
      if (error.noRetry || attempt === 2) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
}

export async function fetchMatches({ fetchPage = fetchHTML, sleep = ms => new Promise(r => setTimeout(r, ms)), now = new Date() } = {}) {
  const references = new Map();
  const coverage = [];
  // All four pages must succeed before any calendar access/writes.
  for (const team of TEAMS) {
    const rows = parseTeamPage(await fetchPage(`${ORIGIN}/team/${team.id}/${team.slug}`), team);
    coverage.push({ team: team.name, listed: rows.length, upcoming: rows.filter(r => r.date > now).length });
    for (const row of rows) {
      const previous = references.get(row.matchId);
      if (previous && (previous.date.getTime() !== row.date.getTime() ||
        previous.teams.map(t => t.id).sort().join() !== row.teams.map(t => t.id).sort().join())) {
        throw new Error(`Conflicting HLTV team pages for ${row.matchId}; retry next run`);
      }
      references.set(row.matchId, row);
    }
    await sleep(1200);
  }
  // Team pages are authoritative. Match-detail endpoints can be blocked independently;
  // don't make synchronization depend on optional BO/stream/venue enrichment.
  const matches = [...references.values()].map(referenceToMatch);
  return { matches, coverage };
}

export function referenceToMatch(reference) {
  const team = TEAMS.find(tracked => reference.teams.some(t => t.id === tracked.id));
  if (!team) throw new Error(`Match has no tracked team: ${reference.matchId}`);
  const opponent = reference.teams.find(t => t.id !== team.id);
  return {
    matchId: reference.matchId, date: reference.date, team: team.name, teamId: team.id,
    opponent: opponent.name, opponentId: opponent.id, competition: reference.competition,
    format: '', location: '', broadcast: '', source: 'hltv.org', url: reference.url,
  };
}
