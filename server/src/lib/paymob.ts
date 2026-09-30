import crypto from 'crypto';
import { config } from '../config';
import { HttpError } from './errors';

// Paymob Accept client, ported from SSS-Community-App src/modules/payments/paymob.service.ts.
// Supports Unified Checkout (secret + public key) and the legacy iframe (API key + iframe id).
// Webhooks are verified with the HMAC secret, or — when none is configured — by reading the
// transaction back from Paymob with our own API key and matching order + amount.

const ACCEPT = 'https://accept.paymob.com';

type Tx = Record<string, unknown>;

export type BillingData = Record<string, string>;

export type CheckoutSession = {
  checkoutUrl: string;
  providerOrderId: string | null;
  rawRequest: Record<string, unknown>;
};

export type PaymentOutcome = {
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  transactionId: string | null;
  providerOrderId: string | null;
  merchantOrderId: string | null;
  amountCents: string | null;
  failureReason: string | null;
  paidAt: Date | null;
};

export const webhookUrl = () => `${config.API_PUBLIC_BASE_URL.replace(/\/+$/, '')}/api/payments/paymob/webhook`;
export const returnUrl = () => `${config.API_PUBLIC_BASE_URL.replace(/\/+$/, '')}/api/payments/paymob/return`;

export function paymobConfigured(): boolean {
  if (!config.PAYMOB_ENABLED || !config.PAYMOB_CARD_INTEGRATION_ID) return false;
  if (!config.PAYMOB_HMAC_SECRET && !config.PAYMOB_API_KEY) return false;
  return config.PAYMOB_FLOW_TYPE === 'LEGACY_IFRAME'
    ? Boolean(config.PAYMOB_API_KEY && config.PAYMOB_IFRAME_ID)
    : Boolean(config.PAYMOB_SECRET_KEY && config.PAYMOB_PUBLIC_KEY);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function read(value: unknown, path: string[]): unknown {
  let cur = value;
  for (const k of path) {
    if (!isObject(cur) || !(k in cur)) return null;
    cur = cur[k];
  }
  return cur;
}

function readString(value: unknown, path: string[]): string | null {
  const v = read(value, path);
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return typeof v === 'string' ? v : '';
}

const integrationId = (v: string): number | string => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : v.trim());

async function postJson(path: string, body: Record<string, unknown>, auth?: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${ACCEPT}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new HttpError(502, 'payment_gateway_unreachable', 'The payment gateway could not be reached');
  }
  const text = await res.text().catch(() => '');
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    // Paymob error bodies echo billing data; log the status and the message only.
    const detail = readString(payload, ['detail']) ?? readString(payload, ['message']) ?? 'Paymob request failed';
    console.error(`[paymob] ${res.status} on ${path}: ${detail}`);
    throw new HttpError(502, 'payment_gateway_error', detail);
  }
  return isObject(payload) ? payload : { value: payload };
}

async function authToken(): Promise<string> {
  const payload = await postJson('/api/auth/tokens', { api_key: config.PAYMOB_API_KEY });
  const token = readString(payload, ['token']);
  if (!token) throw new HttpError(502, 'payment_gateway_error', 'Paymob did not return an auth token');
  return token;
}

export function buildBillingData(input: { name: string; email?: string | null; phone?: string | null }): BillingData {
  const parts = input.name.trim().split(/\s+/).filter(Boolean);
  const digits = String(input.phone ?? '').replace(/[^\d+]/g, '');
  const phone = !digits
    ? '+201000000000'
    : digits.startsWith('+')
      ? digits
      : digits.startsWith('00')
        ? `+${digits.slice(2)}`
        : digits.startsWith('20')
          ? `+${digits}`
          : digits.startsWith('0')
            ? `+2${digits}`
            : `+${digits}`;
  return {
    apartment: 'NA',
    email: input.email?.trim() || 'payments@clubhouse.local',
    floor: 'NA',
    first_name: parts[0] ?? 'Club',
    street: 'NA',
    building: 'NA',
    phone_number: phone,
    shipping_method: 'PKG',
    postal_code: 'NA',
    city: 'Cairo',
    country: 'EG',
    last_name: parts.slice(1).join(' ') || 'Guest',
    state: 'Cairo',
  };
}

export async function createCheckout(input: {
  paymentId: string;
  amountCents: number;
  currency: string;
  billing: BillingData;
}): Promise<CheckoutSession> {
  if (!paymobConfigured()) {
    throw new HttpError(503, 'payments_not_configured', 'Online payment is not available yet. Please try again later.');
  }
  const notify = `${webhookUrl()}?paymentId=${encodeURIComponent(input.paymentId)}`;
  const redirect = `${returnUrl()}?paymentId=${encodeURIComponent(input.paymentId)}`;

  if (config.PAYMOB_FLOW_TYPE === 'LEGACY_IFRAME') {
    const token = await authToken();
    const order = {
      auth_token: token,
      delivery_needed: false,
      amount_cents: input.amountCents,
      currency: input.currency,
      merchant_order_id: input.paymentId,
      items: [],
    };
    const orderRes = await postJson('/api/ecommerce/orders', order);
    const orderId = readString(orderRes, ['id']);
    if (!orderId) throw new HttpError(502, 'payment_gateway_error', 'Paymob did not return an order id');
    const keyReq = {
      auth_token: token,
      amount_cents: input.amountCents,
      expiration: 3600,
      order_id: Number(orderId),
      billing_data: input.billing,
      currency: input.currency,
      integration_id: integrationId(config.PAYMOB_CARD_INTEGRATION_ID),
      lock_order_when_paid: true,
      redirection_url: redirect,
      notification_url: notify,
    };
    const keyRes = await postJson('/api/acceptance/payment_keys', keyReq);
    const paymentToken = readString(keyRes, ['token']) ?? readString(keyRes, ['payment_token']);
    if (!paymentToken) throw new HttpError(502, 'payment_gateway_error', 'Paymob did not return a payment token');
    const url = new URL(`/api/acceptance/iframes/${config.PAYMOB_IFRAME_ID}`, ACCEPT);
    url.searchParams.set('payment_token', paymentToken);
    return {
      checkoutUrl: url.toString(),
      providerOrderId: orderId,
      rawRequest: { flowType: 'LEGACY_IFRAME', order: { ...order, auth_token: '[REDACTED]' } },
    };
  }

  const body = {
    amount: input.amountCents,
    currency: input.currency,
    payment_methods: [integrationId(config.PAYMOB_CARD_INTEGRATION_ID)],
    billing_data: input.billing,
    items: [],
    special_reference: input.paymentId,
    notification_url: notify,
    redirection_url: redirect,
    extras: { paymentId: input.paymentId },
  };
  const res = await postJson('/v1/intention/', body, `Token ${config.PAYMOB_SECRET_KEY}`);
  const clientSecret = readString(res, ['client_secret']);
  if (!clientSecret) throw new HttpError(502, 'payment_gateway_error', 'Paymob did not return a checkout secret');
  const url = new URL('/unifiedcheckout/', ACCEPT);
  url.searchParams.set('publicKey', config.PAYMOB_PUBLIC_KEY);
  url.searchParams.set('clientSecret', clientSecret);
  return {
    checkoutUrl: url.toString(),
    providerOrderId: readString(res, ['order', 'id']) ?? readString(res, ['merchant_order_id']),
    rawRequest: { flowType: 'UNIFIED_CHECKOUT', amount: body.amount, currency: body.currency, special_reference: body.special_reference },
  };
}

export function extractTransaction(payload: unknown): Tx | null {
  if (isObject(payload) && isObject(payload.obj)) return payload.obj;
  return isObject(payload) ? payload : null;
}

export function verifyHmac(tx: Tx, receivedHmac: string | null | undefined, secret: string): boolean {
  if (!receivedHmac || !secret) return false;
  const message = [
    tx.amount_cents,
    tx.created_at,
    tx.currency,
    tx.error_occured,
    tx.has_parent_transaction,
    tx.id,
    tx.integration_id,
    tx.is_3d_secure,
    tx.is_auth,
    tx.is_capture,
    tx.is_refunded,
    tx.is_standalone_payment,
    tx.is_voided,
    read(tx, ['order', 'id']) ?? tx.order_id,
    tx.owner,
    tx.pending,
    read(tx, ['source_data', 'pan']),
    read(tx, ['source_data', 'sub_type']),
    read(tx, ['source_data', 'type']),
    tx.success,
  ]
    .map(stringify)
    .join('');
  const expected = crypto.createHmac('sha512', secret).update(message).digest('hex');
  const received = String(receivedHmac).toLowerCase();
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function inferOutcome(tx: Tx): PaymentOutcome {
  const success = Boolean(tx.success);
  const pending = Boolean(tx.pending);
  const errorOccurred = Boolean(tx.error_occured);
  let status: PaymentOutcome['status'] = 'PENDING';
  if (tx.is_voided) status = 'CANCELED';
  else if (success && !pending && !errorOccurred) status = 'COMPLETED';
  else if (!success && !pending) status = 'FAILED';
  const createdAt = readString(tx, ['created_at']);
  const paidAt = createdAt && !Number.isNaN(new Date(createdAt).getTime()) ? new Date(createdAt) : null;
  return {
    status,
    transactionId: readString(tx, ['id']),
    providerOrderId: readString(tx, ['order', 'id']) ?? readString(tx, ['order_id']),
    merchantOrderId: readString(tx, ['order', 'merchant_order_id']) ?? readString(tx, ['merchant_order_id']),
    amountCents: readString(tx, ['amount_cents']),
    failureReason:
      status === 'FAILED' || status === 'CANCELED'
        ? (readString(tx, ['txn_response_code']) ?? readString(tx, ['data', 'message']))
        : null,
    paidAt,
  };
}

/** Authoritative read-back used when no HMAC secret is configured. Null = unknown transaction. */
export async function fetchTransaction(transactionId: string): Promise<Tx | null> {
  if (!/^\d+$/.test(transactionId)) return null;
  if (!config.PAYMOB_API_KEY) throw new HttpError(503, 'payments_not_configured', 'Paymob API key missing');
  const token = await authToken();
  let res: Response;
  try {
    res = await fetch(`${ACCEPT}/api/acceptance/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new HttpError(502, 'payment_gateway_unreachable', 'The payment gateway could not be reached');
  }
  if (res.status === 404) return null;
  const payload = await res.json().catch(() => null);
  if (!res.ok || !isObject(payload)) throw new HttpError(502, 'payment_gateway_error', 'Paymob transaction lookup failed');
  return payload;
}

/** Paymob test hook so the gateway can be replaced in tests. */
export const paymob = { createCheckout, fetchTransaction };
