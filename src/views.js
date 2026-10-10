import { config } from './config.js';
import { PLANS } from './plans.js';
import { escapeHtml as e } from './util.js';

export function layout({ title, user, body, description }) {
  const desc = description || 'Free QR code generator. Static codes free forever, no sign-up. Editable dynamic QR codes with scan analytics from $9/month.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} · ${e(config.brand)}</title>
<meta name="description" content="${e(desc)}">
<link rel="canonical" href="${e(config.baseUrl)}">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="nav">
  <a class="logo" href="/">${e(config.brand)}</a>
  <nav>
    <a href="/#pricing">Pricing</a>
    ${user
      ? `<a href="/dashboard">Dashboard</a>
         <form method="post" action="/logout" class="inline"><button class="link">Log out</button></form>`
      : `<a href="/login">Log in</a><a class="btn small" href="/signup">Sign up</a>`}
  </nav>
</header>
<main>${body}</main>
<footer class="foot">
  <span>© ${new Date().getFullYear()} ${e(config.brand)}</span>
  <a href="/privacy">Privacy</a>
  <a href="/terms">Terms</a>
</footer>
</body>
</html>`;
}

function pricingCards(user) {
  return Object.values(PLANS).map((p) => {
    const current = user && user.plan === p.id;
    let cta;
    if (current) cta = `<span class="badge">Current plan</span>`;
    else if (p.id === 'free') cta = user ? '' : `<a class="btn ghost" href="/signup">Start free</a>`;
    else if (user) cta = `<form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="${p.id}"><button class="btn">Upgrade to ${p.name}</button></form>`;
    else cta = `<a class="btn" href="/signup?plan=${p.id}">Choose ${p.name}</a>`;
    return `<div class="card plan ${p.id === 'pro' ? 'featured' : ''}">
      <h3>${p.name}</h3>
      <p class="price">$${p.price}<small>/month</small></p>
      <p class="muted">${e(p.blurb)}</p>
      <ul>
        <li>Unlimited static QR codes</li>
        <li>${p.dynamicLimit} dynamic code${p.dynamicLimit === 1 ? '' : 's'}</li>
        <li>${p.analyticsDays >= 365 ? `${p.analyticsDays / 365} year${p.analyticsDays > 365 ? 's' : ''}` : `${p.analyticsDays} days`} of scan history</li>
        ${p.csvExport ? '<li>CSV export of scans</li>' : ''}
        <li>Codes never break if you downgrade</li>
      </ul>
      ${cta}
    </div>`;
  }).join('');
}

export function homePage(user) {
  return layout({
    title: 'Free QR Code Generator — no sign-up, no expiry',
    user,
    body: `
<section class="hero">
  <h1>QR codes that never expire.<br><span class="accent">Editable when you need them.</span></h1>
  <p class="lead">Make a QR code in seconds — free, no account, no watermark, no trial that breaks your printed menus later.</p>
  <div class="generator card">
    <label for="qr-data">Website, text, or anything</label>
    <input id="qr-data" type="text" value="https://example.com" maxlength="1000" autocomplete="off">
    <div class="row">
      <label>Color <input id="qr-fg" type="color" value="#111827"></label>
      <label>Background <input id="qr-bg" type="color" value="#ffffff"></label>
    </div>
    <div id="qr-preview" class="preview" aria-live="polite"></div>
    <div class="row">
      <a id="dl-png" class="btn" download="qr-code.png">Download PNG</a>
      <a id="dl-svg" class="btn ghost" download="qr-code.svg">Download SVG</a>
    </div>
  </div>
</section>

<section class="features">
  <div class="card"><h3>Static: free forever</h3><p>The link is baked into the code. It works as long as the destination exists — we can't turn it off, and we never will try.</p></div>
  <div class="card"><h3>Dynamic: change it after printing</h3><p>Printed 5,000 flyers with a typo in the URL? Update the destination in your dashboard; the printed code keeps working.</p></div>
  <div class="card"><h3>Know what's working</h3><p>See scans per day, device type and country for every dynamic code. No personal data or IP addresses stored.</p></div>
</section>

<section id="pricing" class="pricing">
  <h2>Simple pricing</h2>
  <p class="muted center">Cancel anytime. If you downgrade, your existing codes keep redirecting — you just can't create more over the limit.</p>
  <div class="plans">${pricingCards(user)}</div>
</section>

<section class="faq">
  <h2>FAQ</h2>
  <details><summary>Do the free QR codes expire?</summary><p>No. Static codes contain your link directly and don't pass through our servers, so there's nothing to expire.</p></details>
  <details><summary>What's the difference between static and dynamic?</summary><p>A dynamic code points to a short link on our domain, which redirects to your destination. That lets you change the destination and count scans without reprinting.</p></details>
  <details><summary>What happens to my dynamic codes if I cancel?</summary><p>They keep redirecting. You'll be on the Free plan, so you can't create new dynamic codes beyond its limit or edit codes over the limit until you upgrade again.</p></details>
  <details><summary>Can I use the codes commercially?</summary><p>Yes — on menus, packaging, business cards, posters, anything.</p></details>
</section>
<script src="/app.js" defer></script>`,
  });
}

export function authPage({ mode, error, email = '', plan = '' }) {
  const isSignup = mode === 'signup';
  return layout({
    title: isSignup ? 'Create your account' : 'Log in',
    body: `
<section class="narrow card">
  <h1>${isSignup ? 'Create your account' : 'Welcome back'}</h1>
  ${error ? `<p class="error">${e(error)}</p>` : ''}
  <form method="post" action="/${mode}" class="stack">
    <input type="hidden" name="plan" value="${e(plan)}">
    <label>Email <input type="email" name="email" required value="${e(email)}" autocomplete="email"></label>
    <label>Password <input type="password" name="password" required minlength="8" autocomplete="${isSignup ? 'new-password' : 'current-password'}"></label>
    <button class="btn">${isSignup ? 'Sign up free' : 'Log in'}</button>
  </form>
  <p class="muted">${isSignup ? 'Already have an account? <a href="/login">Log in</a>' : 'New here? <a href="/signup">Create an account</a>'}</p>
</section>`,
  });
}

export function dashboardPage({ user, plan, codes, error, notice, billingEnabled }) {
  const atLimit = codes.length >= plan.dynamicLimit;
  const rows = codes.map((c) => `
    <tr>
      <td><a href="/codes/${c.id}">${e(c.name)}</a></td>
      <td class="url">${e(c.target_url)}</td>
      <td>${c.scans}</td>
      <td><a href="/codes/${c.id}">Manage</a></td>
    </tr>`).join('');
  return layout({
    title: 'Dashboard',
    user,
    body: `
<section class="wide">
  <div class="between">
    <h1>Your dynamic QR codes</h1>
    <div class="plan-pill">${e(plan.name)} plan · ${codes.length}/${plan.dynamicLimit} codes
      ${user.stripe_customer_id && billingEnabled ? `<form method="post" action="/billing/portal" class="inline"><button class="link">Manage billing</button></form>` : ''}
    </div>
  </div>
  ${notice ? `<p class="notice">${e(notice)}</p>` : ''}
  ${error ? `<p class="error">${e(error)}</p>` : ''}
  ${atLimit
    ? `<div class="card upsell"><strong>You've reached your plan's limit.</strong> <a href="/#pricing">Upgrade</a> for more dynamic codes and longer analytics.</div>`
    : `<form method="post" action="/codes" class="card inline-form">
        <input name="name" placeholder="Name (e.g. Table menu)" required maxlength="100">
        <input name="target_url" placeholder="https://your-destination.com" required maxlength="2000">
        <button class="btn">Create dynamic code</button>
      </form>`}
  ${codes.length
    ? `<table class="table"><thead><tr><th>Name</th><th>Destination</th><th>Total scans</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="muted">No dynamic codes yet. Create one above — you can change where it points any time.</p>`}
</section>`,
  });
}

function bars(series) {
  const max = Math.max(1, ...series.map((d) => d.count));
  return `<div class="bars">${series.map((d) =>
    `<div class="bar" title="${e(d.day)}: ${d.count}"><span style="height:${Math.round((d.count / max) * 100)}%"></span></div>`
  ).join('')}</div>`;
}

function breakdown(rows, label) {
  if (!rows.length) return '<p class="muted">No data yet.</p>';
  return `<table class="table compact"><thead><tr><th>${label}</th><th>Scans</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${e(r.key || 'Unknown')}</td><td>${r.count}</td></tr>`).join('')
  }</tbody></table>`;
}

export function codePage({ user, plan, code, stats, shortUrl, editable, error }) {
  return layout({
    title: code.name,
    user,
    body: `
<section class="wide">
  <p><a href="/dashboard">← All codes</a></p>
  <h1>${e(code.name)}</h1>
  ${error ? `<p class="error">${e(error)}</p>` : ''}
  <div class="grid2">
    <div class="card">
      <img class="qr" src="/codes/${code.id}/qr.svg" alt="QR code for ${e(code.name)}" width="240" height="240">
      <p class="muted">Short link: <code>${e(shortUrl)}</code></p>
      <div class="row">
        <a class="btn" href="/codes/${code.id}/qr.png" download="${e(code.slug)}.png">PNG</a>
        <a class="btn ghost" href="/codes/${code.id}/qr.svg" download="${e(code.slug)}.svg">SVG</a>
        ${plan.csvExport ? `<a class="btn ghost" href="/codes/${code.id}/scans.csv">Export CSV</a>` : ''}
      </div>
    </div>
    <div class="card">
      <h3>Destination</h3>
      ${editable
        ? `<form method="post" action="/codes/${code.id}" class="stack">
            <label>Name <input name="name" value="${e(code.name)}" required maxlength="100"></label>
            <label>Redirects to <input name="target_url" value="${e(code.target_url)}" required maxlength="2000"></label>
            <button class="btn">Save changes</button>
          </form>`
        : `<p class="url">${e(code.target_url)}</p>
           <p class="upsell">This code is over your plan's limit, so it keeps redirecting but can't be edited. <a href="/#pricing">Upgrade</a> to edit it.</p>`}
      <form method="post" action="/codes/${code.id}/delete" data-confirm="Delete this code? Printed copies will stop working.">
        <button class="link danger">Delete code</button>
      </form>
    </div>
  </div>
  <div class="card">
    <div class="between"><h3>Scans — last 30 days</h3><strong>${stats.total} total</strong></div>
    ${bars(stats.daily)}
    <p class="muted small">History kept for ${plan.analyticsDays} days on the ${e(plan.name)} plan.</p>
  </div>
  <div class="grid2">
    <div class="card"><h3>Devices</h3>${breakdown(stats.devices, 'Device')}</div>
    <div class="card"><h3>Countries</h3>${breakdown(stats.countries, 'Country')}</div>
  </div>
</section>`,
  });
}

export function messagePage({ title, message, user }) {
  return layout({
    title,
    user,
    body: `<section class="narrow card"><h1>${e(title)}</h1><p>${message}</p><p><a href="/">Go home</a></p></section>`,
  });
}

export function privacyPage(user) {
  return messagePage({
    title: 'Privacy',
    user,
    message: `We store your email, a hashed password, your QR codes, and for each scan of a dynamic code: the time, device class (mobile/desktop/tablet) and country if available. We do not store IP addresses or sell data. Payments are handled by Stripe; we never see your card number. Static codes are generated and served without logging their contents. Email us to delete your account and all associated data.`,
  });
}

export function termsPage(user) {
  return messagePage({
    title: 'Terms',
    user,
    message: `Don't use ${e(config.brand)} for phishing, malware, scams or illegal content — we will disable such codes without notice. Paid plans renew monthly and can be cancelled anytime from the billing portal; access continues until the end of the paid period. Service is provided as-is.`,
  });
}
