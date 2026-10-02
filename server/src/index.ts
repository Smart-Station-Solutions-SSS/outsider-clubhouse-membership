import { buildApp } from './app';
import { config, paymobMockEnabled, paymobMockRefused } from './config';
import { paymobConfigured } from './lib/paymob';
import { startJobs } from './services/jobs';

const app = buildApp();
app.listen(config.PORT, () => {
  console.log(`Outsider clubhouse API on http://localhost:${config.PORT}/api`);
  if (paymobMockRefused) console.warn(`Payments: PAYMOB_MOCK ignored — ${config.WEB_PUBLIC_URL} is not a local site; using real Paymob`);
  if (paymobMockEnabled) console.log('Payments: MOCK checkout (PAYMOB_MOCK=true, development only)');
  else if (!paymobConfigured()) console.warn('Payments: Paymob is NOT configured — checkout will return 503');
  startJobs();
});
