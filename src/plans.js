// Pricing tiers. Static QR codes are free and unlimited on every plan;
// plans only gate *dynamic* (editable, trackable) codes.
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    dynamicLimit: 1,
    analyticsDays: 7,
    csvExport: false,
    blurb: 'Try one dynamic code. Static codes free forever.',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 9,
    dynamicLimit: 50,
    analyticsDays: 365,
    csvExport: false,
    blurb: 'For restaurants, shops and creators.',
  },
  business: {
    id: 'business',
    name: 'Business',
    price: 29,
    dynamicLimit: 500,
    analyticsDays: 365 * 3,
    csvExport: true,
    blurb: 'For agencies and multi-location teams.',
  },
};

export function planFor(user) {
  return PLANS[user?.plan] || PLANS.free;
}
