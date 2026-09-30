import 'dotenv/config';
import { execSync } from 'child_process';

/** Recreate the test database schema once per run. */
export default function setup() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}
