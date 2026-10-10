import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { LANDING_PAGES } from '../src/landing.js';

const config = { baseUrl: '', brand: 'Test QR', isProd: false, stripe: { prices: {} } };
let server;
let base;

before(async () => {
  const app = createApp({ db: openDb(':memory:'), config });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  config.baseUrl = base;
});
after(() => server.close());

describe('SEO landing pages', () => {
  it('renders every landing page with its own title, canonical URL and FAQ schema', async () => {
    for (const page of LANDING_PAGES) {
      const res = await fetch(`${base}/qr-code/${page.slug}`);
      assert.equal(res.status, 200, page.slug);
      const html = await res.text();
      assert.match(html, new RegExp(`<link rel="canonical" href="[^"]*/qr-code/${page.slug}">`), page.slug);
      assert.match(html, new RegExp(`<h1>${page.h1}</h1>`));
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
      assert.equal(ld['@type'], 'FAQPage');
      assert.equal(ld.mainEntity.length, page.faqs.length);
    }
  });

  it('gives each page a unique title and description', () => {
    assert.equal(new Set(LANDING_PAGES.map((p) => p.title)).size, LANDING_PAGES.length);
    assert.equal(new Set(LANDING_PAGES.map((p) => p.description)).size, LANDING_PAGES.length);
    for (const p of LANDING_PAGES) assert.ok(p.description.length <= 160, `${p.slug} description too long`);
  });

  it('shows WiFi fields on the WiFi page', async () => {
    const html = await (await fetch(`${base}/qr-code/wifi`)).text();
    assert.match(html, /id="wifi-ssid"/);
    assert.match(html, /data-mode="wifi"/);
  });

  it('returns 404 for unknown use cases', async () => {
    assert.equal((await fetch(`${base}/qr-code/nope`)).status, 404);
  });

  it('links all use cases from the home page and index', async () => {
    for (const path of ['/', '/qr-code']) {
      const html = await (await fetch(base + path)).text();
      for (const p of LANDING_PAGES) assert.ok(html.includes(`href="/qr-code/${p.slug}"`), `${path} -> ${p.slug}`);
    }
  });

  it('lists public pages in the sitemap and points robots.txt at it', async () => {
    const xml = await (await fetch(`${base}/sitemap.xml`)).text();
    for (const p of LANDING_PAGES) assert.ok(xml.includes(`<loc>${base}/qr-code/${p.slug}</loc>`));
    assert.ok(!xml.includes('/dashboard'));
    const robots = await (await fetch(`${base}/robots.txt`)).text();
    assert.match(robots, /Disallow: \/dashboard/);
    assert.ok(robots.includes(`Sitemap: ${base}/sitemap.xml`));
  });

  it('keeps login and signup out of search results', async () => {
    assert.match(await (await fetch(`${base}/login`)).text(), /name="robots" content="noindex"/);
  });
});
