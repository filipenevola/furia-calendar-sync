import { sync } from './sync.js';
import { logger } from './logger.js';

const args = process.argv.slice(2);
if (args.some(arg => !['--dry-run', '--check-calendar'].includes(arg))) throw new Error('Unknown job option');
const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';
try {
  const result = await sync({ dryRun, checkCalendar: args.includes('--check-calendar') });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Do not serialize API request configs, credentials or response bodies.
  const message = `Calendar job failed: ${error.message}`;
  console.error(JSON.stringify({ status: 'error', dryRun, message }));
  await logger.error(message, new Error(message));
  process.exitCode = 1;
}
