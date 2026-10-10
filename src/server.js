import Stripe from 'stripe';
import { createApp } from './app.js';
import { config } from './config.js';
import { openDb } from './db.js';

const db = openDb(config.dbPath);
const stripe = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;
if (!stripe) console.warn('STRIPE_SECRET_KEY not set — billing is disabled.');

// Expired sessions are swept hourly.
setInterval(() => db.exec("DELETE FROM sessions WHERE expires_at <= datetime('now')"), 3600e3).unref();

createApp({ db, config, stripe }).listen(config.port, () => {
  console.log(`${config.brand} listening on ${config.baseUrl} (port ${config.port})`);
});
