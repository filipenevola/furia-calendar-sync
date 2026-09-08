import { sync } from '../src/sync.js';

const rounds = Number(process.env.VALIDATION_ROUNDS || 3);
const interval = Number(process.env.VALIDATION_INTERVAL_MS || 30000);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10 || !Number.isFinite(interval) || interval < 1000) throw new Error('Invalid validation settings');
// Read-only even if production DRY_RUN=false. Calendar is read only with --check-calendar.
try {
for (let round = 1; round <= rounds; round++) {
  const result = await sync({ dryRun: true, checkCalendar: process.argv.includes('--check-calendar') });
  console.log(JSON.stringify({ round, ...result }));
  if (round < rounds) await Bun.sleep(interval);
}
} catch (error) {
  console.error(JSON.stringify({ status: 'error', message: error.message }));
  process.exitCode = 1;
}
