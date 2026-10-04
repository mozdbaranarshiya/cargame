import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './server/app.js';

const publicDirectory = fileURLToPath(new URL('./', import.meta.url));
const port = Number(process.env.PORT || 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const application = createApplication({
  publicDirectory,
  databasePath: process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH) : resolve(publicDirectory, 'data/game.sqlite'),
  secureCookies: process.env.SECURE_COOKIE === '1' || process.env.PUBLIC_ORIGIN?.startsWith('https://'),
  publicOrigin: process.env.PUBLIC_ORIGIN,
});

application.server.listen(port, '0.0.0.0', () => console.log(`بازی ماشین: http://localhost:${port}`));
application.server.on('error', error => { console.error(`راه‌اندازی سرور ناموفق بود: ${error.code || 'خطای شبکه'}`); process.exitCode = 1; application.close(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { application.close(); });
