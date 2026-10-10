// Central configuration, read once from the environment.
export const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  dbPath: process.env.DB_PATH || 'data/app.db',
  brand: process.env.BRAND_NAME || 'Zee8a QR',
  isProd: process.env.NODE_ENV === 'production',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    prices: {
      pro: process.env.STRIPE_PRICE_PRO || '',
      business: process.env.STRIPE_PRICE_BUSINESS || '',
    },
  },
};
