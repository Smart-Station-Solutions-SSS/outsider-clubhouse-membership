import 'dotenv/config';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

// Usage: npm run apikey:create -- <ADMIN|PARTNER> "<name>"
// Prints the key ONCE; only its sha256 is stored. Put it in SSS's .env.

const prisma = new PrismaClient();

async function main() {
  const [kindArg, ...nameParts] = process.argv.slice(2);
  const kind = String(kindArg ?? '').toUpperCase();
  const name = nameParts.join(' ').trim() || `SSS ${kind.toLowerCase()}`;
  if (kind !== 'ADMIN' && kind !== 'PARTNER') {
    console.error('Usage: npm run apikey:create -- <ADMIN|PARTNER> "<name>"');
    process.exit(1);
  }
  const alnum = (n: number) => crypto.randomBytes(n * 2).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n);
  const prefix = alnum(8);
  const key = `ocm_${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
  await prisma.apiKey.create({
    data: { name, kind, prefix, hash: crypto.createHash('sha256').update(key).digest('hex') },
  });
  console.log(`${kind} key "${name}" created. Store it now — it will not be shown again:\n\n${key}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
