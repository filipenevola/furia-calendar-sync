/**
 * Application configuration
 */

export const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS; // Base64 encoded service account JSON

// Decode GOOGLE_CALENDAR_ID if it's base64 encoded, otherwise use as-is
function decodeCalendarId(calendarId) {
  if (!calendarId || calendarId === 'primary') {
    return 'primary';
  }
  
  // Try to decode as base64, if it fails, use as-is
  try {
    const decoded = Buffer.from(calendarId, 'base64').toString('utf-8');
    // If decoded value looks like an email or calendar ID, use it
    if (decoded.includes('@') || decoded.length > 0) {
      return decoded;
    }
  } catch (e) {
    // Not base64, use as-is
  }
  
  return calendarId;
}

export const GOOGLE_CALENDAR_ID = decodeCalendarId(process.env.GOOGLE_CALENDAR_ID) || 'primary';
