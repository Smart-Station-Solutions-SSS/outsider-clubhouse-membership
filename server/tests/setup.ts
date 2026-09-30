import 'dotenv/config';

// Every test run uses the separate *-test database and the mock checkout.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.PAYMOB_MOCK = 'true';
process.env.PAYMOB_HMAC_SECRET = 'test-hmac-secret';
process.env.SMTP_HOST = '';
process.env.UPLOAD_DIR = './uploads-test';
// SSS catalog sync is off unless a test turns it on (tests/sync.test.ts).
process.env.SSS_API_URL = '';
process.env.SSS_SYNC_KEY = '';
