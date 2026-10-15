import { createHash } from 'node:crypto';
import { load } from 'cheerio';

// HLTV now answers every scripted request with a Cloudflare challenge (2026-10-15).
// Liquipedia's MediaWiki API allows automated reads with an identifying User-Agent,
// gzip, and at most one action=parse request every 30 seconds.
export const TEAMS = Object.freeze([
  { name: 'FURIA', page: 'FURIA' },
  { name: 'Legacy', page: 'Legacy' },
  { name: 'MIBR', page: 'MIBR' },
]);
const ORIGIN = 'https://liquipedia.net';
const API = `${ORIGIN}/counterstrike/api.php`;
export const USER_AGENT = 'br-cs-calendar-sync/1.0 (https://github.com/filipenevola/furia-calendar-sync; filipe@quave.com.br)';
export const PARSE_INTERVAL_MS = 31000;
// Pause before the single retry of a page Liquipedia rate-limited or blocked.
export const BLOCK_RETRY_DELAY_MS = 60000;
const clean = value => value.replace(/\s+/g, ' ').trim();

// A rate limit or block is not data: callers skip the run with no Calendar access.
export class SourceBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SourceBlockedError';
    this.blocked = true;
  }
}

export function parseTimestamp(value) {
  // Liquipedia data-timestamp is UTC seconds, NOT the displayed CEST text.
  if (!/^\d{10}$/.test(value || '') || +value < 946684800 || +value > 4102444800) {
    throw new Error(`Invalid Liquipedia UTC second timestamp: ${value}`);
  }
  return new Date(+value * 1000);
}

// Stable across reschedules: tournament section, stage and both participants.
export function fixtureKey({ tournamentPath, stage, teams }) {
  const names = teams.map(t => t.toLowerCase()).sort().join('|');
  return createHash('sha256').update(`${tournamentPath}|${stage}|${names}`).digest('hex').slice(0, 20);
}

export function parseTeamPage(payload, team) {
  const page = payload?.parse;
  if (!page || page.title !== team.page || typeof page.text !== 'string') {
    throw new Error(`Liquipedia page identity mismatch for ${team.name}`);
  }
  const $ = load(page.text);
  if (!$('.fo-nttax-infobox').length) throw new Error(`Liquipedia team layout mismatch for ${team.name}`);
  // Liquipedia omits the section when a team has nothing scheduled.
  const heading = $('h2#Upcoming_Matches');
  if (!heading.length) return [];
  const items = heading.parent().nextAll().find('.carousel-item .match-info');
  if (!items.length) throw new Error(`Unrecognized upcoming section for ${team.name}`);
  return items.toArray().map(el => {
    const item = $(el);
    const date = parseTimestamp(item.find('.match-info-countdown .timer-object[data-timestamp]').first().attr('data-timestamp'));
    const tournament = item.find('.match-info-tournament-name a').first();
    const tournamentPath = tournament.attr('href');
    const stage = clean(item.find('.match-info-stage').text());
    const competition = [clean(tournament.text()), stage].filter(Boolean).join(' - ');
    if (!tournamentPath?.startsWith('/counterstrike/') || !competition) throw new Error(`Missing tournament for ${team.name} at ${date.toISOString()}`);
    // Opponents without a page (TBD, bracket placeholders) keep their exact label.
    const teams = item.find('.match-info-opponent-row .name').toArray().map(n => clean($(n).text()));
    if (teams.length !== 2 || teams.some(t => !t) || !teams.includes(team.name)) {
      throw new Error(`Invalid Liquipedia match for ${team.name} at ${date.toISOString()}`);
    }
    return { matchId: fixtureKey({ tournamentPath, stage, teams }), url: ORIGIN + tournamentPath, competition, date, teams };
  });
}

export async function fetchPage(team, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const url = `${API}?action=parse&page=${encodeURIComponent(team.page)}&prop=text&format=json&formatversion=2`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        const message = `Liquipedia HTTP ${response.status}: ${team.page}`;
        if ([403, 429].includes(response.status)) throw new SourceBlockedError(message);
        const error = new Error(message);
        error.noRetry = response.status < 500;
        throw error;
      }
      const payload = await response.json();
      if (payload?.error) {
        const error = new Error(`Liquipedia API error for ${team.page}: ${payload.error.code}`);
        if (payload.error.code === 'ratelimited') error.blocked = true;
        else error.noRetry = true;
        throw error;
      }
      return payload;
    } catch (error) {
      // Never hammer a rate limit. Retry only transient failures.
      if (error.blocked || error.noRetry || attempt === 2) throw error;
      await sleep(PARSE_INTERVAL_MS);
    }
  }
}

export async function fetchMatches({ fetchTeam = fetchPage, sleep = ms => new Promise(r => setTimeout(r, ms)), now = new Date() } = {}) {
  const references = new Map();
  const coverage = [];
  const blocks = [];
  // Every team page must succeed before any calendar access/writes.
  for (const [index, team] of TEAMS.entries()) {
    if (index) await sleep(PARSE_INTERVAL_MS);
    let rows;
    try {
      rows = parseTeamPage(await fetchTeam(team), team);
    } catch (error) {
      // One patient retry per run; a second block propagates and the run is skipped.
      if (!error.blocked || blocks.length) throw error;
      blocks.push({ team: team.name, message: error.message });
      console.warn(JSON.stringify({ status: 'warning', message: `${error.message}; retrying once in ${BLOCK_RETRY_DELAY_MS / 1000}s` }));
      await sleep(BLOCK_RETRY_DELAY_MS);
      rows = parseTeamPage(await fetchTeam(team), team);
    }
    coverage.push({ team: team.name, listed: rows.length, upcoming: rows.filter(r => r.date > now).length });
    for (const row of rows) {
      const previous = references.get(row.matchId);
      if (previous && previous.date.getTime() !== row.date.getTime()) {
        throw new Error(`Conflicting Liquipedia team pages for ${row.matchId}; retry next run`);
      }
      references.set(row.matchId, row);
    }
  }
  return { matches: [...references.values()].map(referenceToMatch), coverage, blocks };
}

export function referenceToMatch(reference) {
  // Canonical tracked side independent of which team's page listed a derby.
  const team = TEAMS.find(tracked => reference.teams.includes(tracked.name));
  if (!team) throw new Error(`Match has no tracked team: ${reference.matchId}`);
  const opponent = reference.teams.find(t => t !== team.name) ?? team.name;
  return {
    matchId: reference.matchId, date: reference.date, team: team.name, teamId: null,
    opponent, opponentId: null, competition: reference.competition,
    format: '', location: '', broadcast: '', source: 'liquipedia.net', url: reference.url,
  };
}
