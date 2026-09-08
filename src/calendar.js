import { createHash } from 'node:crypto';
import { google } from 'googleapis';
import { GOOGLE_CREDENTIALS, GOOGLE_CALENDAR_ID, CALENDAR_TIME_ZONE } from './config.js';
import { getMatchUniqueKey } from './processing.js';

export function matchToCalendarEvent(match) {
  const durationHours = match.format === 'MD5' ? 3.5 : match.format === 'MD1' ? 1 : 2;
  return {
    summary: `🎮 ${match.team} vs ${match.opponent}${match.format ? ` (${match.format})` : ''}`,
    description: [
      `🏆 ${match.competition}`, match.location ? `📍 ${match.location}` : '',
      match.format ? `🎯 Format: ${match.format}` : '', `Source: ${match.url}`,
      `Match Date (${CALENDAR_TIME_ZONE}): ${match.date.toLocaleString('pt-BR', { timeZone: CALENDAR_TIME_ZONE })}`,
      `Match ID: ${getMatchUniqueKey(match)}`,
    ].filter(Boolean).join('\n'),
    location: match.location || '',
    start: { dateTime: match.date.toISOString(), timeZone: CALENDAR_TIME_ZONE },
    end: { dateTime: new Date(+match.date + durationHours * 3600000).toISOString(), timeZone: CALENDAR_TIME_ZONE },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 15 }] },
    extendedProperties: { private: {
      furiaSync: 'true', fixtureId: getMatchUniqueKey(match), source: 'hltv.org',
      teamIds: [match.teamId, match.opponentId].sort((a, b) => a - b).join(','),
    } },
  };
}

export function parseCredentials(value) {
  if (!value) throw new Error('GOOGLE_CREDENTIALS is required');
  let credentials;
  // Never include JSON parser error text: it can contain fragments of credentials.
  try { credentials = JSON.parse(value); } catch {
    try { credentials = JSON.parse(Buffer.from(value, 'base64').toString('utf8')); }
    catch { throw new Error('GOOGLE_CREDENTIALS must be service-account JSON or base64 JSON'); }
  }
  if (!credentials?.private_key || !credentials?.client_email) throw new Error('Incomplete Google service-account credentials');
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  return credentials;
}

export function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({ credentials: parseCredentials(GOOGLE_CREDENTIALS), scopes: ['https://www.googleapis.com/auth/calendar.events'] });
  return google.calendar({ version: 'v3', auth });
}

export async function getExistingEvents(calendar, calendarId = GOOGLE_CALENDAR_ID, now = new Date()) {
  const events = [];
  let pageToken;
  do {
    const response = await calendar.events.list({
      calendarId, timeMin: new Date(+now - 7 * 86400000).toISOString(),
      privateExtendedProperty: ['furiaSync=true'], maxResults: 2500,
      singleEvents: true, showDeleted: false, pageToken,
    });
    events.push(...(response.data.items || []).filter(e => e.extendedProperties?.private?.furiaSync === 'true'));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return events;
}

const normalize = value => value.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
export function planCalendarSync(matches, existing) {
  const used = new Set();
  return matches.map(match => {
    const resource = matchToCalendarEvent(match);
    const fixtureId = getMatchUniqueKey(match);
    let candidates = existing.filter(e => e.extendedProperties?.private?.fixtureId === fixtureId);
    if (candidates.length > 1) throw new Error(`Duplicate managed calendar events for ${fixtureId}; review before writing`);
    let migrated = false;
    if (!candidates.length && match.team === 'FURIA') {
      const legacyPrefix = `furia_vs_${normalize(match.opponent)}_`;
      const legacy = existing.filter(e => e.extendedProperties?.private?.fixtureId?.startsWith(legacyPrefix));
      candidates = legacy.filter(e => Math.abs(Date.parse(e.start?.dateTime) - +match.date) <= 6 * 3600000);
      if (candidates.length > 1 || (!candidates.length && legacy.some(e => Date.parse(e.start?.dateTime) > Date.now()))) {
        throw new Error(`Ambiguous Draft5 migration for ${fixtureId}; review before writing`);
      }
      migrated = candidates.length === 1;
    }
    const eventId = candidates[0]?.id;
    if (eventId && used.has(eventId)) throw new Error('Two matches would overwrite one existing event');
    if (eventId) used.add(eventId);
    // Google accepts hexadecimal IDs (base32hex subset). Stable across retries and reschedules.
    const id = eventId || createHash('sha256').update(`br-cs-calendar-sync:${fixtureId}`).digest('hex');
    return { action: eventId ? 'update' : 'create', eventId: id, migrated, fixtureId, resource };
  });
}

export async function syncMatchesToCalendar(matches, { dryRun = false, calendar = getCalendarClient(), calendarId = GOOGLE_CALENDAR_ID } = {}) {
  const existing = await getExistingEvents(calendar, calendarId);
  const plan = planCalendarSync(matches, existing);
  const result = { created: 0, updated: 0, migrated: 0, dryRun, planned: plan.map(p => ({ action: p.action, fixtureId: p.fixtureId, migrated: p.migrated, summary: p.resource.summary, start: p.resource.start })) };
  if (dryRun) return result;
  for (const entry of plan) {
    if (entry.action === 'update') {
      await calendar.events.patch({ calendarId, eventId: entry.eventId, resource: entry.resource });
      result.updated++;
      if (entry.migrated) result.migrated++;
    } else {
      try {
        await calendar.events.insert({ calendarId, resource: { id: entry.eventId, ...entry.resource } });
        result.created++;
      } catch (error) {
        if (Number(error.code || error.response?.status) !== 409) throw error;
        // Resolve an uncertain earlier insert without creating a duplicate or touching unrelated events.
        const { data } = await calendar.events.get({ calendarId, eventId: entry.eventId });
        if (data.status === 'cancelled' || data.extendedProperties?.private?.fixtureId !== entry.fixtureId || data.extendedProperties?.private?.furiaSync !== 'true') throw new Error('Calendar event ID collision');
        await calendar.events.patch({ calendarId, eventId: entry.eventId, resource: entry.resource });
        result.updated++;
      }
    }
  }
  return result;
}
