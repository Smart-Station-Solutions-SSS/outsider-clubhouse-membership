import crypto from 'crypto';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { addDays, formatDay, parseDay, todayCairo } from '../src/lib/dates';
import { ocr, type OcrResult } from '../src/lib/ocr';

const app = buildApp();

const ADULT = '29001010112345'; // born 1990-01-01
const ADULT2 = '28506150198765'; // born 1985-06-15
const CHILD = '31605050123456'; // born 2016-05-05
const SENIOR = '25001010154321'; // born 1950-01-01
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

let ocrAnswer: OcrResult = { kind: 'ok', nationalId: ADULT };
ocr.reader = { read: async () => ocrAnswer };

let clubId: string;
let planMonthly: string;
let bands: Record<string, string>;
let adminKey: string;
let partnerKey: string;

function makeKey(kind: 'ADMIN' | 'PARTNER') {
  const prefix = crypto.randomBytes(8).toString('hex').slice(0, 8);
  const key = `ocm_${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
  return prisma.apiKey
    .create({ data: { name: `test-${kind}`, kind, prefix, hash: crypto.createHash('sha256').update(key).digest('hex') } })
    .then(() => key);
}

async function resetData() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "WebhookLedger","Payment","Pass","VisitRequest","Membership","Member","IdCheck","DayUseFee","PlanPrice","Plan","AgeBand","Club","ApiKey" CASCADE',
  );
  const club = await prisma.club.create({ data: { name: 'Test Club', sssCommunityId: 'sss-community-1', guestDiscountPercent: 20 } });
  clubId = club.id;
  const defs = [
    ['child', 0, 12],
    ['adult', 13, 59],
    ['senior', 60, null],
  ] as const;
  bands = {};
  for (const [label, minAge, maxAge] of defs) {
    bands[label] = (await prisma.ageBand.create({ data: { clubId, label, minAge, maxAge } })).id;
  }
  const plan = await prisma.plan.create({
    data: {
      clubId,
      name: 'Monthly',
      termMonths: 1,
      guestsPerDay: 2,
      prices: { create: [{ ageBandId: bands.adult, price: 1500 }, { ageBandId: bands.senior, price: 1000 }] }, // child: not sold
    },
  });
  planMonthly = plan.id;
  await prisma.dayUseFee.createMany({
    data: [
      { clubId, ageBandId: bands.child, price: 150 },
      { clubId, ageBandId: bands.adult, price: 350 },
    ], // senior: day use not sold
  });
  adminKey = await makeKey('ADMIN');
  partnerKey = await makeKey('PARTNER');
}

const admin = () => ({ 'x-api-key': adminKey });
const setMode = (data: Record<string, unknown>) => request(app).patch(`/api/admin/clubs/${clubId}/settings`).set(admin()).send(data);

type IdCheckBody = {
  checkId: string;
  outcome: string;
  canSubmit: boolean;
  manualEntry: boolean;
  attemptsLeft: number;
  nationalId: string | null;
  dateOfBirth: string | null;
};

/** Uploads a card photo; OCR answers with whatever `ocrAnswer` holds. */
async function idCheck(checkId?: string) {
  const req = request(app).post('/api/id-check');
  if (checkId) req.field('checkId', checkId);
  const res = await req.attach('photo', PHOTO, { filename: 'id.jpg', contentType: 'image/jpeg' });
  expect(res.status).toBe(200);
  return res.body as IdCheckBody;
}

/** A member's guests each come with an ID photo (typed number + photo, no OCR). */
async function withPhotos(guests: { fullName: string; nationalId: string }[]) {
  return Promise.all(
    guests.map(async (g) => {
      const res = await request(app)
        .post('/api/id-check')
        .field('clubId', clubId)
        .field('purpose', 'guest')
        .field('nationalId', g.nationalId)
        .attach('photo', PHOTO, { filename: 'id.jpg', contentType: 'image/jpeg' });
      expect(res.body.outcome).toBe('MANUAL');
      return { ...g, idCheckId: res.body.checkId as string };
    }),
  );
}

async function signup(nationalId = ADULT, email = 'ahmed@example.test') {
  ocrAnswer = { kind: 'ok', nationalId };
  const check = await idCheck();
  expect(check).toMatchObject({ outcome: 'MATCHED', canSubmit: true, nationalId });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signup').send({
    clubId,
    fullName: 'Ahmed Test',
    email,
    phone: '01001234567',
    password: 'password123',
    nationalId,
    idCheckId: check.checkId,
  });
  expect(res.status).toBe(201);
  return { agent, member: res.body.member };
}

async function payViaMock(checkoutUrl: string, success = true) {
  const paymentId = checkoutUrl.split('/mock-pay/')[1];
  const res = await request(app).post(`/api/payments/${paymentId}/mock`).send({ success });
  expect(res.status).toBe(200);
  return res.body;
}

async function activeMember() {
  await setMode({ membershipApproval: 'AUTO' });
  const s = await signup();
  const order = await s.agent.post('/api/me/memberships').send({ planId: planMonthly });
  const pay = await s.agent.post(`/api/me/memberships/${order.body.membership.id}/pay`);
  await payViaMock(pay.body.checkoutUrl);
  return s;
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  ocrAnswer = { kind: 'ok', nationalId: ADULT };
  await resetData();
});

describe('membership applications', () => {
  it('ADMIN mode: waits for review, then prices by age and activates on payment', async () => {
    const { agent, member } = await signup();
    expect(member.status).toBe('PENDING_REVIEW');
    expect(member.dateOfBirth).toBe('1990-01-01');
    expect(member.nationalIdMasked).not.toContain('12345');

    const blocked = await agent.post('/api/me/memberships').send({ planId: planMonthly });
    expect(blocked.status).toBe(403);

    const approved = await request(app).post(`/api/admin/members/${member.id}/approve`).set(admin()).set('x-actor', 'Mona (SSS)').send({});
    expect(approved.body.member.status).toBe('APPROVED');
    expect(approved.body.member.reviewedBy).toContain('Mona');

    const plans = await agent.get('/api/me/plans');
    expect(plans.body.plans[0]).toMatchObject({ name: 'Monthly', price: 1500, ageBandLabel: 'adult' });

    const order = await agent.post('/api/me/memberships').send({ planId: planMonthly });
    expect(order.status).toBe(201);
    const pay = await agent.post(`/api/me/memberships/${order.body.membership.id}/pay`);
    expect(pay.body.checkoutUrl).toContain('/mock-pay/');
    const status = await payViaMock(pay.body.checkoutUrl);
    expect(status.status).toBe('COMPLETED');

    const list = await agent.get('/api/me/memberships');
    const card = list.body.memberships[0];
    expect(card.status).toBe('ACTIVE');
    expect(card.startsAt).toBe(todayCairo());
    expect(card.cardNumber).toMatch(/^OCM-/);
  });

  it('ADMIN mode skips OCR: the typed number and photo go straight to review', async () => {
    ocrAnswer = { kind: 'unavailable' }; // must never be consulted
    const typed = await request(app)
      .post('/api/id-check')
      .field('clubId', clubId)
      .field('purpose', 'membership')
      .field('nationalId', ADULT)
      .attach('photo', PHOTO, { filename: 'id.jpg', contentType: 'image/jpeg' });
    expect(typed.body).toMatchObject({ outcome: 'MANUAL', canSubmit: true, nationalId: ADULT, dateOfBirth: '1990-01-01' });
    const res = await request(app).post('/api/auth/signup').send({
      clubId, fullName: 'Ahmed Test', email: 'm@example.test', phone: '01001234567', password: 'password123', nationalId: ADULT, idCheckId: typed.body.checkId,
    });
    expect(res.body.member).toMatchObject({ status: 'PENDING_REVIEW', ocrStatus: 'MISMATCH_FLAGGED' });
  });

  it('AUTO mode approves a matched ID immediately', async () => {
    await setMode({ membershipApproval: 'AUTO' });
    const { member } = await signup();
    expect(member.status).toBe('APPROVED');
    expect(member.ocrStatus).toBe('MATCHED');
  });

  it('AUTO mode still sends a failed ID (3 tries) to review, flagged', async () => {
    await setMode({ membershipApproval: 'AUTO' });
    ocrAnswer = { kind: 'unreadable' };
    let check = await idCheck();
    for (let i = 0; i < 2; i++) check = await idCheck(check.checkId);
    expect(check).toMatchObject({ canSubmit: false, manualEntry: true, attemptsLeft: 0 });
    const typed = await request(app).post('/api/id-check').field('checkId', check.checkId).field('nationalId', ADULT);
    expect(typed.body).toMatchObject({ canSubmit: true, nationalId: ADULT, dateOfBirth: '1990-01-01' });
    const res = await request(app).post('/api/auth/signup').send({
      clubId, fullName: 'Ahmed Test', email: 'x@example.test', phone: '01001234567', password: 'password123', nationalId: ADULT, idCheckId: check.checkId,
    });
    expect(res.body.member).toMatchObject({ status: 'PENDING_REVIEW', ocrStatus: 'MISMATCH_FLAGGED' });
  });

  it('refuses signup before the ID photo is read, and a plan not sold to the age band', async () => {
    ocrAnswer = { kind: 'unreadable' };
    const check = await idCheck();
    expect(check).toMatchObject({ canSubmit: false, manualEntry: false, attemptsLeft: 2 });
    const early = await request(app).post('/api/id-check').field('checkId', check.checkId).field('nationalId', ADULT);
    expect(early.body.error.code).toBe('photo_required');
    const res = await request(app).post('/api/auth/signup').send({
      clubId, fullName: 'Ahmed Test', email: 'y@example.test', phone: '01001234567', password: 'password123', nationalId: ADULT, idCheckId: check.checkId,
    });
    expect(res.body.error.code).toBe('id_check_required');

    await setMode({ membershipApproval: 'AUTO' });
    const kid = await signup(CHILD, 'kid@example.test');
    const order = await kid.agent.post('/api/me/memberships').send({ planId: planMonthly });
    expect(order.body.error.code).toBe('plan_not_sold');
  });

  it('rejects a duplicate national ID', async () => {
    await signup();
    ocrAnswer = { kind: 'ok', nationalId: ADULT };
    const check = await idCheck();
    const res = await request(app).post('/api/auth/signup').send({
      clubId, fullName: 'Other', email: 'other@example.test', phone: '01001234567', password: 'password123', nationalId: ADULT, idCheckId: check.checkId,
    });
    expect(res.status).toBe(409);
  });
});

describe('day use', () => {
  /** A signed-up account (no plan) books for itself plus companions. */
  const account = async (nationalId = ADULT, email = 'visitor@example.test') => {
    await setMode({ membershipApproval: 'AUTO' });
    return (await signup(nationalId, email)).agent;
  };
  const book = (agent: ReturnType<typeof request.agent>, visitDate: string, companions = [{ fullName: 'Kid Test', nationalId: CHILD }]) =>
    agent.post('/api/me/day-use').send({ visitDate, companions });

  it('needs a login', async () => {
    const res = await request(app).post('/api/me/day-use').send({ visitDate: todayCairo(), companions: [] });
    expect(res.status).toBe(401);
    expect((await request(app).post('/api/day-use').send({})).status).toBe(404);
  });

  it('AUTO: pay straight away, QR per person, check-in once on the day', async () => {
    const agent = await account();
    await setMode({ dayUseApproval: 'AUTO' });
    const res = await book(agent, todayCairo());
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('APPROVED');
    expect(res.body.request.total).toBe(500); // 350 adult (the account holder) + 150 child
    const { id } = res.body.request;

    const pay = await agent.post(`/api/me/day-use/${id}/pay`);
    await payViaMock(pay.body.checkoutUrl);
    const list = await agent.get('/api/me/day-use');
    expect(list.body.requests[0].status).toBe('PAID');
    const qr = list.body.requests[0].passes[0].qrToken;
    expect(qr).toMatch(/^CH-/);

    const first = await request(app).post('/api/admin/check-in').set(admin()).send({ qrToken: qr });
    expect(first.body.pass.status).toBe('USED');
    const again = await request(app).post('/api/admin/check-in').set(admin()).send({ qrToken: qr });
    expect(again.body.error.code).toBe('already_used');
  });

  it('ADMIN: cannot pay until approved', async () => {
    const agent = await account();
    const res = await book(agent, formatDay(addDays(parseDay(todayCairo()), 3)));
    expect(res.body.request.status).toBe('PENDING_REVIEW');
    const { id } = res.body.request;
    expect((await agent.post(`/api/me/day-use/${id}/pay`)).body.error.code).toBe('not_payable');

    const list = await request(app).get(`/api/admin/clubs/${clubId}/visit-requests?status=PENDING_REVIEW`).set(admin());
    expect(list.body.total).toBe(1);
    expect(list.body.requests[0].passes[0].nationalId).toBe(ADULT);

    await request(app).post(`/api/admin/visit-requests/${id}/approve`).set(admin()).send({});
    expect((await agent.post(`/api/me/day-use/${id}/pay`)).status).toBe(200);
  });

  it('an email-only account books with its ID photo, and can apply for membership later', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/auth/register').send({ clubId, email: 'daypass@example.test', password: 'password123' });
    expect(reg.status).toBe(201);
    expect(reg.body.member).toMatchObject({ status: 'ACCOUNT', fullName: null, nationalIdMasked: null });
    expect((await agent.get('/api/me/plans')).body.error.code).toBe('no_application');

    const missing = await book(agent, todayCairo(), []);
    expect(missing.body.error.code).toBe('buyer_required');

    await setMode({ dayUseApproval: 'AUTO' });
    ocrAnswer = { kind: 'ok', nationalId: ADULT };
    const check = await request(app).post('/api/id-check').field('clubId', clubId).field('purpose', 'day-use')
      .attach('photo', PHOTO, { filename: 'id.jpg', contentType: 'image/jpeg' });
    expect(check.body).toMatchObject({ outcome: 'MATCHED', nationalId: ADULT });
    const buyer = { fullName: 'Day Visitor', phone: '01001234567', nationalId: ADULT, idCheckId: check.body.checkId };
    const quote = await agent.post('/api/me/day-use/quote').send({ visitDate: todayCairo(), companions: [], buyer });
    expect(quote.body.total).toBe(350);
    const res = await agent.post('/api/me/day-use').send({ visitDate: todayCairo(), companions: [], buyer });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ status: 'APPROVED', contactName: 'Day Visitor' });

    await setMode({ membershipApproval: 'AUTO' });
    ocrAnswer = { kind: 'ok', nationalId: ADULT };
    const idc = await idCheck();
    const applied = await agent.post('/api/me/apply').send({ fullName: 'Day Visitor', phone: '01001234567', nationalId: ADULT, idCheckId: idc.checkId });
    expect(applied.body.member).toMatchObject({ status: 'APPROVED', dateOfBirth: '1990-01-01' });
    expect((await agent.get('/api/me/plans')).status).toBe(200);
    expect((await agent.post('/api/me/apply').send({ fullName: 'Day Visitor', phone: '01001234567', nationalId: ADULT, idCheckId: idc.checkId })).body.error.code).toBe('already_applied');
  });

  it('accounts with an active membership invite guests instead', async () => {
    const { agent } = await activeMember();
    const res = await book(agent, todayCairo(), []);
    expect(res.body.error.code).toBe('member_use_guests');
  });

  it('refuses ages without a day-use price, past dates and double booking', async () => {
    const agent = await account();
    await setMode({ dayUseApproval: 'AUTO' });
    const senior = await book(agent, todayCairo(), [{ fullName: 'Senior Test', nationalId: SENIOR }]);
    expect(senior.body.error.code).toBe('not_sold');
    const past = await book(agent, formatDay(addDays(parseDay(todayCairo()), -1)));
    expect(past.body.error.code).toBe('date_in_past');
    await book(agent, todayCairo());
    const twice = await book(agent, todayCairo());
    expect(twice.body.error.code).toBe('already_booked');
  });
});

describe('guests', () => {
  it('members invite guests at the discounted price, within the daily limit', async () => {
    const { agent } = await activeMember();
    await setMode({ dayUseApproval: 'AUTO' });
    const visitDate = formatDay(addDays(parseDay(todayCairo()), 2));
    const quote = await agent.post('/api/me/guest-quote').send({ visitDate, guests: [{ fullName: 'Guest One', nationalId: ADULT2 }] });
    expect(quote.body.guests[0].price).toBe(280); // 350 - 20%

    const one = await agent.post('/api/me/guest-requests').send({ visitDate, guests: await withPhotos([{ fullName: 'Guest One', nationalId: ADULT2 }, { fullName: 'Guest Kid', nationalId: CHILD }]) });
    expect(one.status).toBe(201);
    expect(one.body.request.total).toBe(400); // 280 + 120
    expect(one.body.request.status).toBe('PENDING_REVIEW'); // always admin-approved, even in AUTO day-use mode
    expect(one.body.request.passes.every((p: { hasIdPhoto: boolean }) => p.hasIdPhoto)).toBe(true);
    const noPhoto = await agent.post('/api/me/guest-requests').send({ visitDate, guests: [{ fullName: 'Guest Four', nationalId: SENIOR }] });
    expect(noPhoto.status).toBe(400);
    const over = await agent.post('/api/me/guest-requests').send({ visitDate, guests: await withPhotos([{ fullName: 'Guest Three', nationalId: SENIOR }]) });
    expect(over.body.error.code).toMatch(/guest_limit|not_sold/);

    const self = await agent.post('/api/me/guest-requests').send({ visitDate: todayCairo(), guests: await withPhotos([{ fullName: 'Myself', nationalId: ADULT }]) });
    expect(self.body.error.code).toBe('host_as_guest');
  });

  it('non-members cannot invite guests', async () => {
    await setMode({ membershipApproval: 'AUTO' });
    const { agent } = await signup();
    const res = await agent.post('/api/me/guest-requests').send({ visitDate: todayCairo(), guests: await withPhotos([{ fullName: 'Guest One', nationalId: ADULT2 }]) });
    expect(res.body.error.code).toBe('no_active_membership');
  });

  it('SSS residents invite guests through the partner API', async () => {
    await setMode({ dayUseApproval: 'AUTO' });
    const host = { residentId: 'res-42', name: 'Resident Host', phone: '01009998888', guestLimitPerDay: 1 };
    const wrongKey = await request(app).get('/api/partner/communities/sss-community-1/guest-policy').set({ 'x-api-key': adminKey });
    expect(wrongKey.status).toBe(403);

    const policy = await request(app).get('/api/partner/communities/sss-community-1/guest-policy').set({ 'x-api-key': partnerKey });
    expect(policy.body).toMatchObject({ guestDiscountPercent: 20, approval: 'AUTO' });

    const created = await request(app)
      .post('/api/partner/communities/sss-community-1/guest-requests')
      .set({ 'x-api-key': partnerKey })
      .send({ host, visitDate: todayCairo(), guests: [{ fullName: 'Guest One', nationalId: ADULT2 }] });
    expect(created.status).toBe(201);
    const id = created.body.request.id;

    const limit = await request(app)
      .post('/api/partner/communities/sss-community-1/guest-requests')
      .set({ 'x-api-key': partnerKey })
      .send({ host, visitDate: todayCairo(), guests: [{ fullName: 'Guest Two', nationalId: ADULT }] });
    expect(limit.body.error.code).toBe('guest_limit');

    const other = await request(app).post(`/api/partner/guest-requests/${id}/pay?residentId=res-99`).set({ 'x-api-key': partnerKey });
    expect(other.status).toBe(404);
    const pay = await request(app).post(`/api/partner/guest-requests/${id}/pay?residentId=res-42`).set({ 'x-api-key': partnerKey });
    await payViaMock(pay.body.checkoutUrl);
    const view = await request(app).get(`/api/partner/guest-requests/${id}?residentId=res-42`).set({ 'x-api-key': partnerKey });
    expect(view.body.request.passes[0].qrToken).toMatch(/^CH-/);
  });
});

describe('admin API & Paymob webhook', () => {
  it('requires a valid key and validates settings and age bands', async () => {
    expect((await request(app).get('/api/admin/clubs')).status).toBe(401);
    expect((await setMode({ guestDiscountPercent: 101 })).status).toBe(400);
    const ok = await setMode({ membershipApproval: 'AUTO', dayUseApproval: 'AUTO', guestDiscountPercent: 30 });
    expect(ok.body.settings).toMatchObject({ membershipApproval: 'AUTO', dayUseApproval: 'AUTO', guestDiscountPercent: 30 });

    const gap = await request(app).put(`/api/admin/clubs/${clubId}/age-bands`).set(admin()).send({ bands: [{ label: 'a', minAge: 0, maxAge: 10 }, { label: 'b', minAge: 12, maxAge: null }] });
    expect(gap.body.error.code).toBe('invalid_age_bands');
  });

  it('activates only on a correctly signed webhook, once', async () => {
    await setMode({ membershipApproval: 'AUTO' });
    const { agent, member } = await signup();
    const order = await agent.post('/api/me/memberships').send({ planId: planMonthly });
    const payment = await prisma.payment.create({
      data: { clubId, membershipId: order.body.membership.id, amountCents: 150000, currency: 'EGP', provider: 'PAYMOB', providerOrderId: '789', expiresAt: new Date(Date.now() + 3600e3) },
    });
    const tx = {
      amount_cents: 150000, created_at: '2026-09-30T10:00:00', currency: 'EGP', error_occured: false, has_parent_transaction: false,
      id: 555, integration_id: 1, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true,
      is_voided: false, order: { id: 789, merchant_order_id: payment.id }, owner: 1, pending: false, source_data: { pan: '1234', sub_type: 'Visa', type: 'card' }, success: true,
    };
    const msg = ['150000', '2026-09-30T10:00:00', 'EGP', 'false', 'false', '555', '1', 'true', 'false', 'false', 'false', 'true', 'false', '789', '1', 'false', '1234', 'Visa', 'card', 'true'].join('');
    const hmac = crypto.createHmac('sha512', 'test-hmac-secret').update(msg).digest('hex');

    const forged = await request(app).post(`/api/payments/paymob/webhook?paymentId=${payment.id}&hmac=${'0'.repeat(128)}`).send({ obj: tx });
    expect(forged.body.ok).toBe(false);
    const ok = await request(app).post(`/api/payments/paymob/webhook?paymentId=${payment.id}&hmac=${hmac}`).send({ obj: tx });
    expect(ok.body.ok).toBe(true);
    await request(app).post(`/api/payments/paymob/webhook?paymentId=${payment.id}&hmac=${hmac}`).send({ obj: tx });

    const detail = await request(app).get(`/api/admin/members/${member.id}`).set(admin());
    expect(detail.body.memberships.filter((m: { status: string }) => m.status === 'ACTIVE')).toHaveLength(1);
  });
});
