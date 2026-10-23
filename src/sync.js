import { fetchMatches } from './retrieval/liquipedia.js';
import { processMatches } from './processing.js';
import { syncMatchesToCalendar } from './calendar.js';
import { CALENDAR_TIME_ZONE } from './config.js';

export async function sync({ dryRun = false, checkCalendar = false, retrieve = fetchMatches, writeCalendar = syncMatchesToCalendar } = {}) {
  let retrieved;
  try {
    retrieved = await retrieve();
  } catch (error) {
    if (!error.blocked && !error.conflict) throw error;
    // Source rate limits/blocks and conflicting snapshots are intermittent. Keep the
    // Calendar untouched and let the next run read a consistent snapshot.
    return {
      status: 'skipped', checkedAt: new Date().toISOString(), dryRun, reason: error.message,
      calendar: 'untouched', ...(error.conflict ? { conflict: true } : {}),
    };
  }
  const matches = processMatches(retrieved.matches);
  const result = {
    status: 'success', checkedAt: new Date().toISOString(), dryRun,
    coverage: retrieved.coverage, blocks: retrieved.blocks, unscheduled: retrieved.unscheduled,
    fixturesFound: matches.length, timeZone: CALENDAR_TIME_ZONE,
    matches: matches.map(m => ({ id: m.matchId, team: m.team, opponent: m.opponent, competition: m.competition, format: m.format, utc: m.date.toISOString(), local: m.date.toLocaleString('pt-BR', { timeZone: CALENDAR_TIME_ZONE }), url: m.url })),
  };
  if (!dryRun || checkCalendar) result.calendar = await writeCalendar(matches, { dryRun });
  return result;
}
