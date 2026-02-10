import { createServer } from './server.js';
import { startCronScheduler } from './cron.js';

// Start the cron scheduler for daily sync
startCronScheduler();

// Start the web server
createServer();
