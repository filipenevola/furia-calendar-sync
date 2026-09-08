export const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;

export function decodeCalendarId(value) {
  if (!value || value === 'primary') return 'primary';
  if (value.includes('@')) return value;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (/^[^\s@]+@[^\s@]+$/.test(decoded)) return decoded;
  }
  return value;
}
export const GOOGLE_CALENDAR_ID = decodeCalendarId(process.env.GOOGLE_CALENDAR_ID);
export const CALENDAR_TIME_ZONE = process.env.CALENDAR_TIME_ZONE || 'America/Campo_Grande';
// Validate the IANA name immediately. Match timestamps always remain UTC instants.
new Intl.DateTimeFormat('en', { timeZone: CALENDAR_TIME_ZONE }).format();
