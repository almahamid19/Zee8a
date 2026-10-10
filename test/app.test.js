import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const config = {
  port: 0,
  baseUrl: '',
  brand: 'Test QR',
  isProd: false,
  stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_test', prices: { pro: 'price_pro', business: 'price_biz' } },
};

// Minimal stand-in for the Stripe SDK surface the app uses.
const fakeStripe = {
  customers: { create: async () => ({ id: 'cus_1' }) },
  checkout: { sessions: { create: async (args) => ({ url: `https://checkout.stripe.com/test?price=${args.line_items[0].price}` }) } },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } },
  subscriptions: { retrieve: async () => { throw new Error('unused'); } },
  webhooks: {
    constructEvent(body, signature) {
      if (signature !== 'valid') throw new Error('bad signature');
      return JSON.parse(body.toString());
    },
  },
};

let server;
let base;
let db;

before(async () => {
  db = openDb(':memory:');
  const app = createApp({ db, config, stripe: fakeStripe });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  config.baseUrl = base;
});
after(() => server.close());

const form = (data) => new URLSearchParams(data).toString();

async function post(path, data, cookie = '', headers = {}) {
  return fetch(base + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, ...headers },
    body: form(data),
  });
}

async function get(path, cookie = '') {
  return fetch(base + path, { redirect: 'manual', headers: { cookie } });
}

async function signup(email) {
  const res = await post('/signup', { email, password: 'correct-horse' });
  assert.equal(res.status, 302);
  return res.headers.get('set-cookie').split(';')[0];
}

function webhook(event) {
  return fetch(`${base}/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 'valid' },
    body: JSON.stringify(event),
  });
}

describe('public pages', () => {
  it('serves the home page with pricing', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /id="pricing"/);
    assert.match(html, /\$9/);
  });

  it('generates free static QR codes as SVG and PNG', async () => {
    const svg = await get('/api/qr?data=hello&fg=ff0000');
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get('content-type'), /svg/);
    assert.match(await svg.text(), /#ff0000/);

    const png = await get('/api/qr?data=hello&format=png');
    assert.equal(png.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await png.arrayBuffer());
    assert.deepEqual([...bytes.slice(1, 4)], [80, 78, 71]); // "PNG"
  });

  it('rejects empty or oversized static payloads', async () => {
    assert.equal((await get('/api/qr?data=')).status, 400);
    assert.equal((await get(`/api/qr?data=${'a'.repeat(1001)}`)).status, 400);
  });
});

describe('accounts and dynamic codes', () => {
  let cookie;
  let codeId;
  let slug;

  it('signs up, logs in, and rejects bad credentials', async () => {
    cookie = await signup('owner@example.com');
    assert.equal((await post('/signup', { email: 'OWNER@example.com', password: 'correct-horse' })).status, 400);
    assert.equal((await post('/login', { email: 'owner@example.com', password: 'wrong-pass' })).status, 401);
    assert.equal((await post('/login', { email: 'owner@example.com', password: 'correct-horse' })).status, 302);
    assert.equal((await get('/dashboard')).headers.get('location'), '/login');
  });

  it('creates a dynamic code and redirects scans to its target', async () => {
    const res = await post('/codes', { name: 'Menu', target_url: 'example.com/menu' }, cookie);
    assert.equal(res.status, 302);
    codeId = res.headers.get('location').split('/').pop();
    slug = db.prepare('SELECT slug FROM codes WHERE id = ?').get(codeId).slug;

    const scan = await fetch(`${base}/r/${slug}`, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (iPhone)', 'cf-ipcountry': 'US' } });
    assert.equal(scan.status, 302);
    assert.equal(scan.headers.get('location'), 'https://example.com/menu');
    assert.equal(scan.headers.get('cache-control'), 'no-store');

    const page = await (await get(`/codes/${codeId}`, cookie)).text();
    assert.match(page, /1 total/);
    assert.match(page, /mobile/);
    assert.match(page, /US/);
  });

  it('rejects non-http targets', async () => {
    const res = await post(`/codes/${codeId}`, { name: 'Menu', target_url: 'javascript:alert(1)' }, cookie);
    assert.equal(res.status, 400);
  });

  it('lets the owner change the destination after printing', async () => {
    await post(`/codes/${codeId}`, { name: 'Menu', target_url: 'https://example.com/new-menu' }, cookie);
    const scan = await fetch(`${base}/r/${slug}`, { redirect: 'manual' });
    assert.equal(scan.headers.get('location'), 'https://example.com/new-menu');
  });

  it('enforces the free plan limit', async () => {
    const res = await post('/codes', { name: 'Second', target_url: 'https://example.com' }, cookie);
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Upgrade/);
  });

  it('hides codes from other users', async () => {
    const other = await signup('other@example.com');
    assert.equal((await get(`/codes/${codeId}`, other)).status, 404);
    assert.equal((await post(`/codes/${codeId}/delete`, {}, other)).status, 404);
  });

  it('blocks cross-site form posts', async () => {
    const res = await post('/codes', { name: 'x', target_url: 'https://evil.example' }, cookie, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });
});

describe('billing', () => {
  let cookie;

  it('sends users to Stripe Checkout for the chosen plan', async () => {
    cookie = await signup('payer@example.com');
    const res = await post('/billing/checkout', { plan: 'pro' }, cookie);
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /checkout\.stripe\.com.*price_pro/);
    assert.equal(db.prepare("SELECT stripe_customer_id FROM users WHERE email = 'payer@example.com'").get().stripe_customer_id, 'cus_1');
  });

  it('rejects webhooks with a bad signature', async () => {
    const res = await fetch(`${base}/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': 'nope', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 400);
  });

  it('upgrades on an active subscription and keeps codes working after cancellation', async () => {
    const sub = { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_pro' } }] } };
    assert.equal((await webhook({ type: 'customer.subscription.created', data: { object: sub } })).status, 200);
    const plan = () => db.prepare("SELECT plan FROM users WHERE email = 'payer@example.com'").get().plan;
    assert.equal(plan(), 'pro');

    const ids = [];
    for (const name of ['A', 'B', 'C']) {
      const res = await post('/codes', { name, target_url: `https://example.com/${name}` }, cookie);
      assert.equal(res.status, 302);
      ids.push(res.headers.get('location').split('/').pop());
    }

    await webhook({ type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } });
    assert.equal(plan(), 'free');

    // Over-limit codes still redirect but become read-only.
    const slug = db.prepare('SELECT slug FROM codes WHERE id = ?').get(ids[2]).slug;
    assert.equal((await fetch(`${base}/r/${slug}`, { redirect: 'manual' })).status, 302);
    assert.equal((await post(`/codes/${ids[2]}`, { name: 'C', target_url: 'https://x.example' }, cookie)).status, 400);
    assert.equal((await post(`/codes/${ids[0]}`, { name: 'A2', target_url: 'https://x.example' }, cookie)).status, 302);
  });

  it('gates CSV export to the Business plan', async () => {
    const id = db.prepare("SELECT c.id FROM codes c JOIN users u ON u.id = c.user_id WHERE u.email = 'payer@example.com' ORDER BY c.id").get().id;
    assert.equal((await get(`/codes/${id}/scans.csv`, cookie)).status, 403);
    const sub = { id: 'sub_2', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_biz' } }] } };
    await webhook({ type: 'customer.subscription.created', data: { object: sub } });
    const res = await get(`/codes/${id}/scans.csv`, cookie);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /^scanned_at,device,country/);
  });
});
