/**
 * Calendar sync logic
 * 
 * This module converts standardized Match format to Google Calendar events.
 * Works only with standardized Match format - independent of retrieval logic.
 */

import { google } from 'googleapis';
import { logger, ensureError } from './logger.js';
import { GOOGLE_CREDENTIALS, GOOGLE_CALENDAR_ID } from './config.js';
import { getMatchUniqueKey } from './processing.js';

/**
 * Converts a Match to a Google Calendar event
 * @param {Match} match - Match in standardized format
 * @returns {Object} Google Calendar event resource
 */
export function matchToCalendarEvent(match) {
  const startDateTime = match.date;
  // CS matches: ~2h for MD3, ~3.5h for MD5
  const durationHours = match.format === 'MD5' ? 3.5 : 2;
  const endDateTime = new Date(startDateTime.getTime() + durationHours * 60 * 60 * 1000);
  
  let summary = `🎮 FURIA vs ${match.opponent}`;
  if (match.format) {
    summary += ` (${match.format})`;
  }
  
  // Generate unique key based on teams and competition (not date/time)
  const uniqueKey = getMatchUniqueKey(match);
  
  return {
    summary: summary,
    description: [
      `🏆 ${match.competition}`,
      `📍 ${match.location || 'Online'}`,
      match.broadcast ? `📺 ${match.broadcast}` : '',
      match.format ? `🎯 Format: ${match.format}` : '',
      ``,
      `Source: ${match.source}`,
      `Match Date: ${startDateTime.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      ``,
      `Match ID: ${uniqueKey}`
    ].filter(Boolean).join('\n'),
    location: match.location || '',
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
    extendedProperties: {
      private: {
        furiaSync: 'true',
        fixtureId: uniqueKey,
      }
    }
  };
}

function parseCredentials(credentialsString) {
  if (!credentialsString) {
    throw new Error('GOOGLE_CREDENTIALS environment variable is not set');
  }

  let credentials;
  
  // Try to parse as base64 first, then as plain JSON
  try {
    const decoded = Buffer.from(credentialsString, 'base64').toString('utf-8');
    credentials = JSON.parse(decoded);
  } catch (base64Error) {
    // If base64 decoding fails, try parsing as plain JSON
    try {
      credentials = JSON.parse(credentialsString);
    } catch (jsonError) {
      throw new Error(
        `Failed to parse GOOGLE_CREDENTIALS: ${base64Error.message}. ` +
        `Also tried as plain JSON: ${jsonError.message}`
      );
    }
  }

  // Validate required fields
  if (!credentials.private_key) {
    throw new Error('GOOGLE_CREDENTIALS missing required field: private_key');
  }
  if (!credentials.client_email) {
    throw new Error('GOOGLE_CREDENTIALS missing required field: client_email');
  }

  // Fix private key formatting - ensure newlines are preserved
  if (typeof credentials.private_key === 'string') {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    
    if (!credentials.private_key.includes('BEGIN PRIVATE KEY')) {
      logger.info('[CALENDAR] Warning: Private key may be missing proper PEM formatting');
    }
  }

  return credentials;
}

export async function getCalendarClient() {
  try {
    const credentials = parseCredentials(GOOGLE_CREDENTIALS);
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    
    // Test the auth by getting the client email
    const client = await auth.getClient();
    const projectId = await auth.getProjectId().catch(() => null);
    
    logger.info('[CALENDAR] Google Calendar client initialized successfully', {
      clientEmail: credentials.client_email,
      projectId: projectId || 'unknown'
    });
    
    return google.calendar({ version: 'v3', auth });
  } catch (err) {
    const error = ensureError(err);
    if (err.code) {
      error.code = err.code;
    }
    if (err.code === 'ERR_OSSL_CRT_VALUES_INCORRECT') {
      error.hint = 'The private key in GOOGLE_CREDENTIALS appears to be corrupted. Please verify the credentials are correctly base64-encoded.';
    } else {
      error.hint = 'Please check that GOOGLE_CREDENTIALS is properly formatted and contains valid service account credentials.';
    }
    
    logger.error('[CALENDAR] Failed to initialize Google Calendar client', error);
    throw err;
  }
}

export async function getExistingEvents(calendar) {
  try {
    const now = new Date();
    const response = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: now.toISOString(),
      maxResults: 2500,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    const furiaEvents = (response.data.items || []).filter(event => 
      event.extendedProperties?.private?.furiaSync === 'true'
    );
    
    const fixtureMap = new Map();
    for (const event of furiaEvents) {
      const fixtureId = event.extendedProperties?.private?.fixtureId;
      if (fixtureId) {
        fixtureMap.set(fixtureId, event.id);
      }
    }
    
    logger.info(`[CALENDAR] Found ${fixtureMap.size} existing FURIA events in calendar`);
    return fixtureMap;
  } catch (err) {
    const error = ensureError(err);
    logger.error('[CALENDAR] Failed to fetch existing events', error);
    throw err;
  }
}

/**
 * Syncs matches to Google Calendar
 * @param {Match[]} matches - Matches in standardized format
 * @returns {Promise<Object>} Sync result with counts
 */
export async function syncMatchesToCalendar(matches) {
  logger.info('[CALENDAR] Starting calendar sync...');
  
  const calendar = await getCalendarClient();
  const existingEvents = await getExistingEvents(calendar);
  
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  
  for (const match of matches) {
    const event = matchToCalendarEvent(match);
    const fixtureId = event.extendedProperties.private.fixtureId;
    const existingEventId = existingEvents.get(fixtureId);
    
    try {
      if (existingEventId) {
        await calendar.events.update({
          calendarId: GOOGLE_CALENDAR_ID,
          eventId: existingEventId,
          resource: event,
        });
        logger.info(`[CALENDAR] Updated: ${event.summary}`);
        updated++;
      } else {
        await calendar.events.insert({
          calendarId: GOOGLE_CALENDAR_ID,
          resource: event,
        });
        logger.info(`[CALENDAR] Created: ${event.summary}`);
        created++;
      }
    } catch (err) {
      const error = ensureError(err);
      error.fixture = event.summary;
      error.fixtureId = fixtureId;
      const errorMsg = `${event.summary} - ${error.message}`;
      logger.error(`[CALENDAR] Failed to sync event: ${errorMsg}`, error);
      errors.push({ fixture: event.summary, error: error.message });
      skipped++;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return {
    created,
    updated,
    skipped,
    errors,
    total: matches.length
  };
}
