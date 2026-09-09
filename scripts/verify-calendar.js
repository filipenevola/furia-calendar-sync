import { fetchMatches } from '../src/retrieval/hltv.js';
import { processMatches, getMatchUniqueKey } from '../src/processing.js';
import { getCalendarClient, getExistingEvents, matchToCalendarEvent } from '../src/calendar.js';

try {
  const { matches } = await fetchMatches();
  const upcoming = processMatches(matches);
  const events = await getExistingEvents(getCalendarClient());
  const verified = upcoming.map(match => {
    const key = getMatchUniqueKey(match);
    const found = events.filter(e => e.extendedProperties?.private?.fixtureId === key);
    const expected = matchToCalendarEvent(match, found[0]?.summary);
    if (found.length !== 1 || Date.parse(found[0].start?.dateTime) !== +match.date ||
        found[0].start?.timeZone !== expected.start.timeZone || found[0].summary !== expected.summary) {
      throw new Error(`Calendar verification mismatch: ${key}`);
    }
    return { fixtureId: key, utc: match.date.toISOString(), summary: found[0].summary, timeZone: found[0].start.timeZone };
  });
  console.log(JSON.stringify({ status: 'verified', checkedAt: new Date().toISOString(), verified }));
} catch (error) {
  console.error(JSON.stringify({ status: 'error', message: error.message }));
  process.exitCode = 1;
}
