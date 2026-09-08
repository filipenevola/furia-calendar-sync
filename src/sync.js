import { fetchMatches } from './retrieval/hltv.js';
import { processMatches } from './processing.js';
import { syncMatchesToCalendar } from './calendar.js';
import { CALENDAR_TIME_ZONE } from './config.js';

export async function sync({ dryRun = false, checkCalendar = false, retrieve = fetchMatches, writeCalendar = syncMatchesToCalendar } = {}) {
  const retrieved = await retrieve();
  const matches = processMatches(retrieved.matches);
  const result = {
    status: 'success', checkedAt: new Date().toISOString(), dryRun,
    coverage: retrieved.coverage, unscheduled: retrieved.unscheduled,
    fixturesFound: matches.length, timeZone: CALENDAR_TIME_ZONE,
    matches: matches.map(m => ({ id: m.matchId, team: m.team, opponent: m.opponent, competition: m.competition, format: m.format, utc: m.date.toISOString(), local: m.date.toLocaleString('pt-BR', { timeZone: CALENDAR_TIME_ZONE }), url: m.url })),
  };
  if (!dryRun || checkCalendar) result.calendar = await writeCalendar(matches, { dryRun });
  return result;
}
