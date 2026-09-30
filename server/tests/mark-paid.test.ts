import crypto from 'crypto';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';

// POST /api/admin/memberships/:id/mark-paid — the SSS desk recording a payment it took.

const app = buildApp();

let adminKey: string;
let membershipId: string;

async function makeAdminKey() {
  const prefix = crypto.randomBytes(8).toString('hex').slice(0, 8);
  const key = `ocm_${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
  await prisma.apiKey.create({
    data: { name: 'sss-dashboard', kind: 'ADMIN', prefix, hash: crypto.createHash('sha256').update(key).digest('hex') },
  });
  return key;
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "WebhookLedger","Payment","Pass","VisitRequest","Membership","Member","IdCheck","DayUseFee","PlanPrice","Plan","AgeBand","Club","ApiKey" CASCADE',
  );
  const club = await prisma.club.create({ data: { name: 'Desk Club', currency: 'EGP' } });
  const band = await prisma.ageBand.create({ data: { clubId: club.id, label: 'adult', minAge: 0, maxAge: null } });
  const plan = await prisma.plan.create({ data: { clubId: club.id, name: 'Quarterly', termMonths: 3, guestsPerDay: 1 } });
  const member = await prisma.member.create({
    data: {
      clubId: club.id,
      email: 'desk@example.test',
      phone: '01001234567',
      passwordHash: 'x',
      fullName: 'Desk Payer',
      nationalIdEnc: 'x',
      nationalIdHash: 'h',
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      ocrStatus: 'MATCHED',
      status: 'APPROVED',
    },
  });
  const m = await prisma.membership.create({
    data: { memberId: member.id, planId: plan.id, ageBandId: band.id, ageAtPurchase: 36, price: 1234.5 },
  });
  membershipId = m.id;
  adminKey = await makeAdminKey();
});

const markPaid = (id: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/admin/memberships/${id}/mark-paid`)
    .set({ 'x-api-key': adminKey, 'x-actor': 'Front Desk (admin-1)' })
    .send(body);

describe('admin mark-paid', () => {
  it('activates the card and books a COMPLETED manual payment for the full price', async () => {
    const res = await markPaid(membershipId, { reference: 'RCPT-77', note: 'cash' });
    expect(res.status).toBe(200);
    expect(res.body.membership).toMatchObject({ id: membershipId, status: 'ACTIVE', member: { fullName: 'Desk Payer' } });
    expect(res.body.membership.cardNumber).toMatch(/^OCM-/);
    expect(res.body.membership.startsAt).toBeTruthy();

    const payments = await prisma.payment.findMany({ where: { membershipId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      provider: 'MANUAL',
      status: 'COMPLETED',
      amountCents: 123450,
      currency: 'EGP',
      providerTransactionId: 'RCPT-77',
    });
    expect(payments[0].rawRequest).toMatchObject({ recordedBy: 'sss-dashboard:Front Desk (admin-1)', note: 'cash' });
  });

  it('refuses a second mark-paid and leaves no extra payment behind', async () => {
    expect((await markPaid(membershipId)).status).toBe(200);
    const again = await markPaid(membershipId);
    expect(again.status).toBe(409);
    expect(again.body.error?.code ?? again.body.code).toBe('not_payable');
    expect(await prisma.payment.count({ where: { membershipId } })).toBe(1);
  });

  it('refuses a cancelled order and an unknown id', async () => {
    await prisma.membership.update({ where: { id: membershipId }, data: { status: 'CANCELLED' } });
    expect((await markPaid(membershipId)).status).toBe(409);
    expect(await prisma.payment.count()).toBe(0);
    expect((await markPaid(crypto.randomUUID())).status).toBe(404);
  });

  it('with clubId, refuses a card of another club as not found', async () => {
    const other = await prisma.club.create({ data: { name: 'Other Club' } });
    expect((await markPaid(membershipId, { clubId: other.id })).status).toBe(404);
    expect(await prisma.payment.count()).toBe(0);
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { member: true } });
    expect((await markPaid(membershipId, { clubId: m.member.clubId })).status).toBe(200);
  });

  it('needs an ADMIN key', async () => {
    const res = await request(app).post(`/api/admin/memberships/${membershipId}/mark-paid`).send({});
    expect(res.status).toBe(401);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe('PENDING_PAYMENT');
  });
});
