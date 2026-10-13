import { createHash } from 'node:crypto';

// The Job has no volume, so the count of consecutive HLTV-blocked runs lives in
// one private event on the service account's own calendar, never on the shared one.
const STATE_CALENDAR_ID = 'primary';
export const STATE_EVENT_ID = createHash('sha256').update('br-cs-calendar-sync:block-streak').digest('hex');
export const NOTIFY_EVERY = Number(process.env.BLOCK_NOTIFY_EVERY || 10);

async function read(calendar) {
  try {
    const { data } = await calendar.events.get({ calendarId: STATE_CALENDAR_ID, eventId: STATE_EVENT_ID });
    return { exists: data.status !== 'cancelled', streak: Number(data.extendedProperties?.private?.blockStreak) || 0 };
  } catch (error) {
    if (Number(error.code || error.response?.status) === 404) return { exists: false, streak: 0 };
    throw error;
  }
}

async function write(calendar, exists, streak) {
  const resource = {
    summary: 'br-cs-calendar-sync state', transparency: 'transparent',
    start: { date: '2000-01-01' }, end: { date: '2000-01-02' },
    extendedProperties: { private: { blockStreak: String(streak), updatedAt: new Date().toISOString() } },
  };
  if (exists) await calendar.events.patch({ calendarId: STATE_CALENDAR_ID, eventId: STATE_EVENT_ID, resource });
  else await calendar.events.insert({ calendarId: STATE_CALENDAR_ID, resource: { id: STATE_EVENT_ID, ...resource } });
}

// Returns the streak including this blocked run and whether to notify:
// 1-9 stay silent, 10 notifies, 11-19 silent, 20 notifies, and so on.
export async function recordBlockedRun(calendar, every = NOTIFY_EVERY) {
  const state = await read(calendar);
  const streak = state.streak + 1;
  await write(calendar, state.exists, streak);
  return { streak, notify: streak % every === 0 };
}

// A successful sync ends the streak. Writes only when a streak was open.
export async function recordSuccessfulRun(calendar) {
  const state = await read(calendar);
  if (state.streak) await write(calendar, state.exists, 0);
  return { previousStreak: state.streak };
}
