import express from 'express';
import QRCode from 'qrcode';
import { PLANS, planFor } from './plans.js';
import {
  HEX_COLOR, deviceFromUserAgent, hashPassword, isValidEmail, newSlug, newToken,
  normalizeTargetUrl, parseCookies, rateLimit, verifyPassword,
} from './util.js';
import {
  authPage, codePage, dashboardPage, homePage, messagePage, privacyPage, termsPage,
} from './views.js';

const SESSION_DAYS = 30;
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function createApp({ db, config, stripe = null }) {
  const app = express();
  if (config.isProd) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userByCustomer: db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?'),
    insertUser: db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)'),
    setCustomer: db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?'),
    setPlan: db.prepare('UPDATE users SET plan = ?, stripe_subscription_id = ? WHERE id = ?'),
    insertSession: db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"),
    sessionUser: db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')"),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    codesForUser: db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM scans s WHERE s.code_id = c.id) AS scans
                              FROM codes c WHERE c.user_id = ? ORDER BY c.id`),
    codeCount: db.prepare('SELECT COUNT(*) AS n FROM codes WHERE user_id = ?'),
    codeForUser: db.prepare('SELECT * FROM codes WHERE id = ? AND user_id = ?'),
    codeBySlug: db.prepare('SELECT * FROM codes WHERE slug = ?'),
    codeRank: db.prepare('SELECT COUNT(*) AS n FROM codes WHERE user_id = ? AND id < ?'),
    insertCode: db.prepare('INSERT INTO codes (user_id, slug, name, target_url) VALUES (?, ?, ?, ?)'),
    updateCode: db.prepare('UPDATE codes SET name = ?, target_url = ? WHERE id = ?'),
    deleteCode: db.prepare('DELETE FROM codes WHERE id = ?'),
    insertScan: db.prepare('INSERT INTO scans (code_id, device, country) VALUES (?, ?, ?)'),
    scanTotal: db.prepare("SELECT COUNT(*) AS n FROM scans WHERE code_id = ? AND scanned_at >= datetime('now', ?)"),
    scanDaily: db.prepare(`SELECT date(scanned_at) AS day, COUNT(*) AS count FROM scans
                           WHERE code_id = ? AND scanned_at >= datetime('now', '-29 days', 'start of day')
                           GROUP BY day`),
    scanDevices: db.prepare(`SELECT device AS key, COUNT(*) AS count FROM scans
                             WHERE code_id = ? AND scanned_at >= datetime('now', ?) GROUP BY key ORDER BY count DESC`),
    scanCountries: db.prepare(`SELECT country AS key, COUNT(*) AS count FROM scans
                               WHERE code_id = ? AND scanned_at >= datetime('now', ?) GROUP BY key ORDER BY count DESC LIMIT 20`),
    scanRows: db.prepare("SELECT scanned_at, device, country FROM scans WHERE code_id = ? AND scanned_at >= datetime('now', ?) ORDER BY id"),
  };

  const shortUrl = (code) => `${config.baseUrl}/r/${code.slug}`;
  const billingEnabled = Boolean(stripe && config.stripe.prices.pro && config.stripe.prices.business);

  // --- Stripe webhook (needs the raw body, so it's mounted before body parsers) ---
  app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe) return res.status(503).send('Billing not configured');
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    }
    try {
      if (event.type === 'checkout.session.completed' && event.data.object.subscription) {
        const sub = await stripe.subscriptions.retrieve(event.data.object.subscription);
        applySubscription(sub);
      } else if (event.type.startsWith('customer.subscription.')) {
        applySubscription(event.data.object);
      }
      res.json({ received: true });
    } catch (err) {
      console.error('Webhook handling failed', err);
      res.status(500).send('Webhook handler error');
    }
  });

  function planForPrice(priceId) {
    return Object.entries(config.stripe.prices).find(([, id]) => id && id === priceId)?.[0] || null;
  }

  function applySubscription(sub) {
    const user = q.userByCustomer.get(sub.customer);
    if (!user) return;
    // Ignore events for a subscription that has been replaced by a newer one.
    if (user.stripe_subscription_id && user.stripe_subscription_id !== sub.id && sub.status === 'canceled') return;
    const paidPlan = planForPrice(sub.items?.data?.[0]?.price?.id);
    if (PAID_STATUSES.has(sub.status) && paidPlan) q.setPlan.run(paidPlan, sub.id, user.id);
    else q.setPlan.run('free', null, user.id);
  }

  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.static(new URL('../public', import.meta.url).pathname, { maxAge: config.isProd ? '1d' : 0 }));

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
    });
    next();
  });

  // Cross-site form posts are rejected; SameSite=Lax cookies are the second layer.
  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.get('origin');
    if (!origin || origin === config.baseUrl) return next();
    let host = null;
    try { host = new URL(origin).host; } catch { /* opaque origin such as "null" */ }
    if (host !== req.get('host')) return res.status(403).send('Cross-site request blocked');
    next();
  });

  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    req.user = token ? q.sessionUser.get(token) || null : null;
    req.sessionToken = token;
    next();
  });

  const requireUser = (req, res, next) => (req.user ? next() : res.redirect('/login'));

  function startSession(res, userId) {
    const token = newToken();
    q.insertSession.run(token, userId, `+${SESSION_DAYS} days`);
    res.cookie('sid', token, {
      httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: SESSION_DAYS * 864e5, path: '/',
    });
  }

  // --- Public pages ---
  app.get('/', (req, res) => res.send(homePage(req.user)));
  app.get('/privacy', (req, res) => res.send(privacyPage(req.user)));
  app.get('/terms', (req, res) => res.send(termsPage(req.user)));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Free static QR codes: the payload is encoded directly, nothing is stored.
  app.get('/api/qr', async (req, res) => {
    const data = String(req.query.data ?? '');
    if (!data || data.length > 1000) return res.status(400).send('data must be 1–1000 characters');
    const color = {
      dark: HEX_COLOR.test(req.query.fg ?? '') ? `#${String(req.query.fg).replace('#', '')}` : '#111827',
      light: HEX_COLOR.test(req.query.bg ?? '') ? `#${String(req.query.bg).replace('#', '')}` : '#ffffff',
    };
    await sendQr(res, data, req.query.format === 'png' ? 'png' : 'svg', color);
  });

  async function sendQr(res, data, format, color = { dark: '#111827', light: '#ffffff' }) {
    const opts = { errorCorrectionLevel: 'M', margin: 2, color };
    try {
      if (format === 'png') {
        res.type('png').send(await QRCode.toBuffer(data, { ...opts, width: 1024 }));
      } else {
        res.type('image/svg+xml').send(await QRCode.toString(data, { ...opts, type: 'svg' }));
      }
    } catch {
      res.status(400).send('Could not encode QR code');
    }
  }

  // --- Auth ---
  const authLimiter = rateLimit({ windowMs: 15 * 60e3, max: 20 });

  app.get('/signup', (req, res) => res.send(authPage({ mode: 'signup', plan: req.query.plan })));
  app.get('/login', (req, res) => res.send(authPage({ mode: 'login' })));

  app.post('/signup', authLimiter, async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const plan = PLANS[req.body.plan] && req.body.plan !== 'free' ? req.body.plan : '';
    const fail = (error) => res.status(400).send(authPage({ mode: 'signup', error, email, plan }));
    if (!isValidEmail(email)) return fail('Please enter a valid email address.');
    if (password.length < 8 || password.length > 200) return fail('Password must be at least 8 characters.');
    if (q.userByEmail.get(email)) return fail('An account with that email already exists. Try logging in.');
    const { lastInsertRowid } = q.insertUser.run(email, await hashPassword(password));
    startSession(res, Number(lastInsertRowid));
    res.redirect(plan && billingEnabled ? `/billing/checkout?plan=${plan}` : '/dashboard');
  });

  app.post('/login', authLimiter, async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const user = q.userByEmail.get(email);
    if (!user || !(await verifyPassword(String(req.body.password ?? ''), user.password_hash))) {
      return res.status(401).send(authPage({ mode: 'login', error: 'Wrong email or password.', email }));
    }
    startSession(res, user.id);
    res.redirect('/dashboard');
  });

  app.post('/logout', (req, res) => {
    if (req.sessionToken) q.deleteSession.run(req.sessionToken);
    res.clearCookie('sid', { path: '/' });
    res.redirect('/');
  });

  // --- Dashboard & dynamic codes ---
  function renderDashboard(req, res, extra = {}) {
    res.status(extra.error ? 400 : 200).send(dashboardPage({
      user: req.user,
      plan: planFor(req.user),
      codes: q.codesForUser.all(req.user.id),
      billingEnabled,
      notice: req.query.upgraded ? 'Thanks for upgrading! Your plan updates as soon as Stripe confirms payment.' : '',
      ...extra,
    }));
  }

  app.get('/dashboard', requireUser, (req, res) => renderDashboard(req, res));

  app.post('/codes', requireUser, (req, res) => {
    const plan = planFor(req.user);
    if (q.codeCount.get(req.user.id).n >= plan.dynamicLimit) {
      return renderDashboard(req, res, { error: `Your ${plan.name} plan allows ${plan.dynamicLimit} dynamic code(s). Upgrade for more.` });
    }
    const name = String(req.body.name ?? '').trim().slice(0, 100);
    const target = normalizeTargetUrl(req.body.target_url);
    if (!name) return renderDashboard(req, res, { error: 'Please give the code a name.' });
    if (!target) return renderDashboard(req, res, { error: 'Please enter a valid http(s) URL.' });
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { lastInsertRowid } = q.insertCode.run(req.user.id, newSlug(), name, target);
        return res.redirect(`/codes/${lastInsertRowid}`);
      } catch (err) {
        if (!/UNIQUE/.test(err.message)) throw err;
      }
    }
    renderDashboard(req, res, { error: 'Could not create code, please retry.' });
  });

  function loadCode(req, res, next) {
    const code = q.codeForUser.get(Number(req.params.id), req.user.id);
    if (!code) return res.status(404).send(messagePage({ title: 'Not found', message: 'That code does not exist.', user: req.user }));
    req.code = code;
    // Codes beyond the current plan's limit (after a downgrade) keep redirecting but are read-only.
    req.codeEditable = q.codeRank.get(req.user.id, code.id).n < planFor(req.user).dynamicLimit;
    next();
  }

  function renderCode(req, res, error = '') {
    const plan = planFor(req.user);
    const window = `-${plan.analyticsDays} days`;
    const daily = new Map(q.scanDaily.all(req.code.id).map((r) => [r.day, r.count]));
    const series = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      series.push({ day, count: daily.get(day) || 0 });
    }
    res.status(error ? 400 : 200).send(codePage({
      user: req.user,
      plan,
      code: req.code,
      shortUrl: shortUrl(req.code),
      editable: req.codeEditable,
      error,
      stats: {
        total: q.scanTotal.get(req.code.id, window).n,
        daily: series,
        devices: q.scanDevices.all(req.code.id, window),
        countries: q.scanCountries.all(req.code.id, window),
      },
    }));
  }

  app.get('/codes/:id', requireUser, loadCode, (req, res) => renderCode(req, res));

  app.post('/codes/:id', requireUser, loadCode, (req, res) => {
    if (!req.codeEditable) return renderCode(req, res, 'Upgrade your plan to edit this code.');
    const name = String(req.body.name ?? '').trim().slice(0, 100);
    const target = normalizeTargetUrl(req.body.target_url);
    if (!name || !target) return renderCode(req, res, 'Please enter a name and a valid http(s) URL.');
    q.updateCode.run(name, target, req.code.id);
    res.redirect(`/codes/${req.code.id}`);
  });

  app.post('/codes/:id/delete', requireUser, loadCode, (req, res) => {
    q.deleteCode.run(req.code.id);
    res.redirect('/dashboard');
  });

  app.get('/codes/:id/qr.svg', requireUser, loadCode, (req, res) => sendQr(res, shortUrl(req.code), 'svg'));
  app.get('/codes/:id/qr.png', requireUser, loadCode, (req, res) => sendQr(res, shortUrl(req.code), 'png'));

  app.get('/codes/:id/scans.csv', requireUser, loadCode, (req, res) => {
    const plan = planFor(req.user);
    if (!plan.csvExport) return res.status(403).send('CSV export is available on the Business plan.');
    const rows = q.scanRows.all(req.code.id, `-${plan.analyticsDays} days`);
    const csv = ['scanned_at,device,country', ...rows.map((r) => `${r.scanned_at},${r.device},${r.country ?? ''}`)].join('\n');
    res.attachment(`${req.code.slug}-scans.csv`).type('text/csv').send(csv);
  });

  // --- The redirect that printed dynamic codes point at ---
  app.get('/r/:slug', (req, res) => {
    const code = q.codeBySlug.get(req.params.slug);
    if (!code) return res.status(404).send(messagePage({ title: 'Code not found', message: 'This QR code is no longer active.' }));
    const countryHeader = req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || '';
    const country = /^[A-Z]{2}$/.test(countryHeader) ? countryHeader : null;
    q.insertScan.run(code.id, deviceFromUserAgent(req.get('user-agent')), country);
    res.set('Cache-Control', 'no-store').redirect(302, code.target_url);
  });

  // --- Billing ---
  async function checkout(req, res, next) {
    try {
      const plan = String(req.body?.plan ?? req.query.plan ?? '');
      if (!billingEnabled) {
        return res.status(503).send(messagePage({ title: 'Billing unavailable', message: 'Payments are not configured yet. Please check back soon.', user: req.user }));
      }
      if (plan !== 'pro' && plan !== 'business') return res.redirect('/#pricing');
      let customerId = req.user.stripe_customer_id;
      if (customerId && req.user.stripe_subscription_id) {
        // Existing subscribers change plans in the Stripe portal to avoid double billing.
        return portal(req, res, next);
      }
      if (!customerId) {
        const customer = await stripe.customers.create({ email: req.user.email, metadata: { userId: String(req.user.id) } });
        customerId = customer.id;
        q.setCustomer.run(customerId, req.user.id);
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: String(req.user.id),
        line_items: [{ price: config.stripe.prices[plan], quantity: 1 }],
        allow_promotion_codes: true,
        success_url: `${config.baseUrl}/dashboard?upgraded=1`,
        cancel_url: `${config.baseUrl}/#pricing`,
      });
      res.redirect(303, session.url);
    } catch (err) {
      next(err);
    }
  }

  async function portal(req, res, next) {
    try {
      if (!billingEnabled || !req.user.stripe_customer_id) return res.redirect('/dashboard');
      const session = await stripe.billingPortal.sessions.create({
        customer: req.user.stripe_customer_id,
        return_url: `${config.baseUrl}/dashboard`,
      });
      res.redirect(303, session.url);
    } catch (err) {
      next(err);
    }
  }

  app.get('/billing/checkout', requireUser, checkout);
  app.post('/billing/checkout', requireUser, checkout);
  app.post('/billing/portal', requireUser, portal);

  app.use((req, res) => res.status(404).send(messagePage({ title: 'Not found', message: 'That page does not exist.', user: req.user })));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send(messagePage({ title: 'Something went wrong', message: 'Please try again in a moment.', user: req.user }));
  });

  return app;
}
