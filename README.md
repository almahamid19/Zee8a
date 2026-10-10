# Zee8a QR — honest dynamic QR codes

A micro-SaaS that makes QR codes:

- **Static codes: free, unlimited, no account.** They're the top-of-funnel that brings in search traffic.
- **Dynamic codes: paid.** They point at a short link (`/r/abc123`) you can re-target after printing, and every scan is counted (day, device, country — no IPs stored).
- **Plans:** Free (1 dynamic code), Pro $9/mo (50 codes), Business $29/mo (500 codes + CSV export). Billing runs through Stripe Checkout and the Stripe Customer Portal.
- **The pitch that sets it apart:** competitors often switch printed codes off when a trial ends. Here, codes keep redirecting even after a user downgrades. Over-limit codes just become read-only.

## Run locally

```bash
npm install
npm start          # http://localhost:3000 (billing disabled until Stripe vars are set)
npm test
```

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`). The only dependencies are express, qrcode, and stripe.

## Go live (≈1 hour)

1. **Domain:** buy a short, neutral one. It's printed inside every dynamic code forever, so never change it.
2. **Host:** any Node host with a persistent disk (Fly.io, Railway, Render, a $6 VPS). Mount a volume and point `DB_PATH` at it. Back that file up daily, because it holds every customer's redirects.
3. **Stripe:**
   - Create two recurring prices ($9 and $29/month).
   - Enable the Customer Portal.
   - Add a webhook to `https://yourdomain.com/stripe/webhook` with `checkout.session.completed` and `customer.subscription.created/updated/deleted`.
4. Copy `.env.example` to `.env`, fill it in, and set `NODE_ENV=production`.
5. Put Cloudflare in front (free). It provides TLS, caching for `/api/qr`, and the `cf-ipcountry` header that powers country analytics.

## The road to $10K/month

The code is the easy part. Revenue comes from distribution. The math:

| Mix | Monthly revenue |
|---|---|
| 1,112 × Pro | $10,008 |
| 600 × Pro + 160 × Business | $10,040 |

At a typical 1–3% visitor→paid conversion for tool sites, that's roughly **40–100K monthly visitors**. Realistically that takes 6–18 months of consistent work. Nothing here guarantees it.

1. **SEO pages (the main channel).** "QR code generator" plus long-tail terms get enormous search volume. Add one page per use case, each with the generator embedded: *QR code for restaurant menu*, *for Wi-Fi*, *for business cards*, *for Google reviews*, *for PDFs*, *for Instagram*, and so on.
2. **Target the people who pay:** restaurants, real estate agents, event organizers, packaging and print shops, marketing agencies. Cold outreach, local Facebook groups, and partnering with print shops for referrals.
3. **Launch posts:** Product Hunt, Indie Hackers, and r/SideProject. The "we'll never hold your printed codes hostage" angle is a strong story.
4. **Grow ARPU over time:** annual plans (2 months free), custom domains, logo-in-QR, team seats, and bulk CSV creation for the Business tier.

## Operational must-dos

- **Abuse:** people will try to use dynamic codes for phishing. Watch new codes, honor reports quickly, and consider checking targets against Google Safe Browsing before going big.
- **Backups and uptime monitoring:** if the redirect goes down, thousands of printed menus break.
- **Email:** add password reset and transactional email (Postmark/Resend) before heavy marketing. It isn't built yet.
