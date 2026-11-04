import { sync } from './sync.js';
import { logger } from './logger.js';
import { getCalendarClient } from './calendar.js';
import { recordBlockedRun, recordSuccessfulRun, NOTIFY_EVERY } from './block-streak.js';
import { t3Request } from './t3.js';

const args = process.argv.slice(2);
if (args.some(arg => !['--dry-run', '--check-calendar'].includes(arg))) throw new Error('Unknown job option');
const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';

// Block-streak bookkeeping must never turn a sync result into a failure.
async function trackStreak(record) {
  if (dryRun) return null;
  try {
    return await record(getCalendarClient());
  } catch (error) {
    console.warn(JSON.stringify({ status: 'warning', message: `Block streak not updated: ${error.message}` }));
    return null;
  }
}

try {
  const result = await sync({ dryRun, checkCalendar: args.includes('--check-calendar') });
  if (result.status === 'skipped') {
    // Expected source block: exit 0. Slack hears about it only every NOTIFY_EVERY consecutive blocked runs.
    const streak = await trackStreak(recordBlockedRun);
    console.warn(JSON.stringify({ ...result, blockStreak: streak?.streak, message: `Calendar sync skipped: ${result.reason}` }));
    if (streak?.notify) {
      await logger.warn(`The match source has blocked ${streak.streak} sync runs in a row (about ${streak.streak / 2}h without a Calendar update). ` +
        `Calendar is untouched and each run keeps retrying; next notice after ${NOTIFY_EVERY} more blocked runs. Latest: ${result.reason}`);
    }
  } else {
    if (result.status === 'success' && !dryRun) result.blockStreak = await trackStreak(recordSuccessfulRun);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  // Do not serialize API request configs, credentials or response bodies.
  const message = `Calendar job failed: ${error.message}`;
  console.error(JSON.stringify({ status: 'error', dryRun, message }));
  // Real failures mention t3fn in Slack, which investigates and opens a fix PR. A dry run only logs.
  await logger.error(dryRun ? message : t3Request(message), new Error(message));
  process.exitCode = 1;
}
