// promo-templates.js — professional, ready-to-send promotions shared by the panel UI and the backend.
// Every template is fully editable: the panel copies its fields into a campaign the manager can change,
// preview and send. Placeholders {name}, {app}, {trial}, {support}, {code}, {discount}, {credit} are
// filled per recipient by the backend at preview/send time.

export const PROMO_CATEGORIES = Object.freeze([
  { id: 'general', name: 'Ready to send', icon: '⚡', desc: 'Evergreen campaigns for any day of the year.' },
  { id: 'football', name: 'Football', icon: '⚽', desc: 'Match days, tournaments and seasonal football campaigns.' },
  { id: 'basketball', name: 'Basketball', icon: '🏀', desc: 'Game days, playoffs and finals basketball campaigns.' },
  { id: 'reseller', name: 'Reseller', icon: '🤝', desc: 'Credit bundles, recharge bonuses and exclusive reseller deals.' },
  { id: 'credit', name: 'Credit', icon: '💳', desc: 'Bonus credits, extra-credit packs, loyalty and limited-time deals.' },
]);

const mail = ({ title, intro, points = [], cta = 'See the offer', url = '{trial}', code = '', accent = '#7C4DFF', foot = true }) => `<div style="font-family:Arial,Helvetica,sans-serif;background:#0f1118;padding:24px 12px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
    <div style="background:${accent};padding:26px 28px;color:#fff"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85">{app}</div><h1 style="margin:8px 0 0;font-size:28px;line-height:1.2">${title}</h1></div>
    <div style="padding:26px 28px;color:#1c2030">
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px">Hi {name},</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 18px">${intro}</p>
      ${points.length ? `<ul style="margin:0 0 20px;padding-left:20px;color:#34394c;font-size:15px;line-height:1.8">${points.map((p) => `<li>${p}</li>`).join('')}</ul>` : ''}
      ${code ? `<p style="margin:0 0 18px"><span style="display:inline-block;background:#f1edff;color:${accent};border:1px dashed ${accent};border-radius:8px;padding:10px 16px;font-weight:bold;letter-spacing:1px">Use code ${code}</span></p>` : ''}
      <p style="margin:0"><a href="${url}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:bold">${cta}</a></p>
      ${foot ? `<p style="font-size:13px;color:#7a8196;margin:22px 0 0;line-height:1.6">Not interested? You can <a href="{support}" style="color:${accent}">unsubscribe here</a>. We only send offers you can opt out of any time.</p>` : ''}
    </div>
  </div>
</div>`;

const T = (o) => Object.freeze({
  id: o.id, category: o.category, icon: o.icon || (PROMO_CATEGORIES.find((c) => c.id === o.category) || {}).icon || '🎉',
  name: o.name, badge: o.badge || 'Ready', title: o.title, description: o.description,
  subject: o.subject || o.title, html: o.html, whatsapp: o.whatsapp,
  notifTitle: o.notifTitle || o.title, notifBody: o.notifBody || o.description,
  code: o.code || '', discountPct: o.discountPct || 0, creditAmount: o.creditAmount || 0, bonusPct: o.bonusPct || 0,
  audience: o.audience || 'all', channels: o.channels || ['email', 'whatsapp', 'notification'],
  tags: o.tags || [], link: o.link || '{trial}',
});

export const PROMO_TEMPLATES = Object.freeze([
  // ---------------- Ready to send (general) ----------------
  T({ id: 'season-kickoff', category: 'general', name: 'New season kickoff', badge: 'All year', accent: '#7C4DFF',
    title: 'A new season of entertainment starts now', description: 'Kick off a new season with a limited-time offer on annual plans and multi-device packs.',
    subject: 'Your new season starts on {app} 🍿',
    html: mail({ title: 'A new season starts now', intro: 'New series, new matches and new movies are landing. Make sure you are ready with the best value on {app}.', points: ['1-year plans from less than $10 a month', 'Watch on every device, at home or on the go', 'Free trial available for new customers'], cta: 'Explore the plans', code: '{code}' }),
    whatsapp: '🎬 *New season on {app}*\nHey {name}, the new season is here! Catch every show, match and movie with our best-value plans.\n\n👉 Free trial: {trial}\n💬 Support: {support}',
    notifTitle: '🍿 New season is live', notifBody: 'A fresh season of shows, matches and movies is waiting. Open {app} to see what is new.', audience: 'all', tags: ['season', 'evergreen', 'all year'] }),

  T({ id: 'weekend-binge', category: 'general', name: 'Weekend binge', badge: 'All year', accent: '#0ea5e9',
    title: 'Make this weekend a binge-worthy one', description: 'A relaxed weekend offer for active and expiring customers, with a simple discount code.',
    subject: 'Your weekend lineup is ready 🍿',
    html: mail({ title: 'Weekend binge mode: ON', intro: 'No plans? Good. We lined up something for every mood this weekend on {app}.', points: ['Thousands of live channels and on-demand titles', 'Watch on your TV, phone or tablet', 'Use code {code} before Sunday'], cta: 'Start watching', code: '{code}', accent: '#0ea5e9' }),
    whatsapp: '🍿 *Weekend binge on {app}*\nHi {name}, your weekend lineup is ready. Use code {code} for {discount}% off and settle in.\n\n🎁 Trial: {trial}',
    notifTitle: '🍿 Weekend binge', notifBody: 'Your weekend lineup is ready. Open {app} and press play.', audience: 'expiring', tags: ['weekend', 'discount'] }),

  T({ id: 'win-back', category: 'general', name: 'Win-back offer', badge: 'Re-engage', accent: '#f59e0b',
    title: 'Come back to {app} — we saved you a seat', description: 'A warm win-back campaign for expired customers with a bonus-credit incentive.',
    subject: 'We miss you, {name} 💛',
    html: mail({ title: 'Come back to {app}', intro: 'It has been a while, {name}. Your favourite channels are still here and we have a little welcome-back gift for you.', points: ['A special welcome-back discount', 'All your favourites, ready when you are', 'Setup takes two minutes'], cta: 'Reactivate now', code: '{code}', accent: '#f59e0b' }),
    whatsapp: '👋 *Welcome back to {app}*\nHi {name}, we saved you a seat. Come back with code {code} and enjoy {discount}% off your plan.\n\n💬 Need help? {support}',
    notifTitle: '👋 Welcome back', notifBody: 'We saved you a seat at {app}. Check your welcome-back offer.', audience: 'expired', tags: ['win-back', 'expired'] }),

  T({ id: 'free-trial-invite', category: 'general', name: 'Free trial invite', badge: 'Acquisition', accent: '#22c55e',
    title: 'Try {app} free — no card needed', description: 'Invite friends and prospects to try the service free for 24 hours.',
    subject: 'Watch free for 24 hours 🎁',
    html: mail({ title: 'Try {app} — on us', intro: 'Curious about {app}? Take a free 24-hour trial and see for yourself. No card needed.', points: ['24 hours of full access', 'Thousands of channels and on-demand titles', 'Works on every device'], cta: 'Claim free trial', url: '{trial}', accent: '#22c55e' }),
    whatsapp: '🎁 *Free 24-hour trial*\nHey {name}, try {app} free — no card needed. Start here: {trial}\n\nQuestions? {support}',
    notifTitle: '🎁 Free trial', notifBody: 'Try {app} free for 24 hours. No card needed.', audience: 'all', tags: ['trial', 'acquisition'] }),

  T({ id: 'refer-a-friend', category: 'general', name: 'Refer a friend', badge: 'Growth', accent: '#ec4899',
    title: 'Give a friend great TV, get free days', description: 'Encourage happy customers to refer friends in exchange for free days on their own line.',
    subject: 'Refer a friend, get free days 🤝',
    html: mail({ title: 'Good things are better shared', intro: 'Know someone who would love {app}? Refer them and earn free days on your own line once they subscribe.', points: ['Your friend keeps the normal price', 'You earn free days, not a price change', 'Unlimited referrals'], cta: 'Get my referral link', url: '{trial}', accent: '#ec4899' }),
    whatsapp: '🤝 *Refer a friend, get free days*\nHi {name}, share {app} with a friend and earn free days on your line when they join.\n\nStart here: {trial}',
    notifTitle: '🤝 Refer & earn', notifBody: 'Refer a friend and get free days on your {app} line.', audience: 'active', tags: ['referral', 'growth'] }),

  // ---------------- Football ----------------
  T({ id: 'match-day-football', category: 'football', name: 'Football match day', badge: 'Match day', accent: '#16a34a',
    title: 'Match day is better in high definition', description: 'A match-day campaign for football fans: push it a few hours before kick-off.',
    subject: 'Kick-off soon — are you ready? ⚽',
    html: mail({ title: 'Match day is here ⚽', intro: 'The big game is almost on, {name}. Make sure you have the clearest stream and the full pre-match build-up on {app}.', points: ['Live football in stunning HD', 'Pre-match analysis and highlights', 'Watch on any device, no buffering'], cta: 'Get match-ready', code: '{code}', accent: '#16a34a' }),
    whatsapp: '⚽ *Match day on {app}*\nHi {name}, kick-off is coming! Watch every moment in HD. Use code {code} for {discount}% off.\n\n▶️ {trial}',
    notifTitle: '⚽ Match day', notifBody: 'Kick-off is near. Get match-ready on {app} with code {code}.', audience: 'all', tags: ['football', 'matchday', 'live'] }),

  T({ id: 'champions-night', category: 'football', name: 'Champions League night', badge: 'Tournament', accent: '#1d4ed8',
    title: 'Champions League nights deserve the big screen', description: 'Tournament promotion for European nights — ideal for the group stage and knockouts.',
    subject: 'Champions League night is on 🏆',
    html: mail({ title: 'European nights, front row', intro: 'The Champions League is back, {name}. Every pass, every goal, every drama — live on {app}.', points: ['All matches live and on demand', 'Multi-device: TV, phone, tablet', 'Special tournament offer with code {code}'], cta: 'Watch the Champions League', code: '{code}', accent: '#1d4ed8' }),
    whatsapp: '🏆 *Champions League night*\nHi {name}, the big European nights are here. Watch every match live on {app}. Code {code} = {discount}% off.\n\n▶️ {trial}',
    notifTitle: '🏆 Champions League', notifBody: 'European nights are here. Watch every match live on {app}.', audience: 'all', tags: ['football', 'tournament', 'ucl'] }),

  T({ id: 'football-final', category: 'football', name: 'Cup final party', badge: 'Seasonal', accent: '#dc2626',
    title: 'The final — watch it like you are there', description: 'High-energy seasonal campaign for a cup or league final, with a match-day discount.',
    subject: 'The final is here 🔴⚽',
    html: mail({ title: 'One match. One trophy.', intro: 'This is the one everybody talks about, {name}. Watch the final live in crystal-clear HD on {app}.', points: ['Full build-up, live match and highlights', 'Crystal-clear HD on every screen', 'Final-week offer: {discount}% off with code {code}'], cta: 'Join the final', code: '{code}', accent: '#dc2626' }),
    whatsapp: '🏆 *The final is here*\nHi {name}, do not miss the big final! Live HD on {app}. Code {code} gives {discount}% off.\n\n▶️ {trial}',
    notifTitle: '🏆 Final day', notifBody: 'The final is here. Watch it live in HD on {app}.', audience: 'all', tags: ['football', 'final', 'seasonal'] }),

  T({ id: 'football-season-opener', category: 'football', name: 'Football season opener', badge: 'Seasonal', accent: '#059669',
    title: 'The league is back — get in before the first whistle', description: 'Season-opener campaign to win new sign-ups and re-engage last season’s viewers.',
    subject: 'Football is back ⚽',
    html: mail({ title: 'The league is back', intro: 'Early mornings, late nights and everything in between — the new football season starts on {app}.', points: ['Every match of the season', 'Catch-up and highlights on demand', 'Season-opener discount with code {code}'], cta: 'Get season-ready', code: '{code}', accent: '#059669' }),
    whatsapp: '⚽ *The season is back*\nHi {name}, the new football season starts now. Watch every match on {app}. Code {code} = {discount}% off.\n\n▶️ {trial}',
    notifTitle: '⚽ Season opener', notifBody: 'The football season is back. Get season-ready on {app}.', audience: 'expired', tags: ['football', 'season'] }),

  // ---------------- Basketball ----------------
  T({ id: 'hoops-game-day', category: 'basketball', name: 'Basketball game day', badge: 'Game day', accent: '#ea580c',
    title: 'Game day: every bucket, live', description: 'Game-day campaign for basketball fans, perfect to schedule a few hours before tip-off.',
    subject: 'Tip-off soon — do not miss it 🏀',
    html: mail({ title: 'Game day is on 🏀', intro: 'Fast breaks, buzzer beaters and overtime — watch every bucket live on {app}.', points: ['Live basketball in HD', 'Full game replays and highlights', 'Game-day deal: {discount}% off with code {code}'], cta: 'Get game-ready', code: '{code}', accent: '#ea580c' }),
    whatsapp: '🏀 *Basketball game day*\nHi {name}, tip-off is near! Watch every bucket live on {app}. Code {code} = {discount}% off.\n\n▶️ {trial}',
    notifTitle: '🏀 Game day', notifBody: 'Tip-off is near. Watch live basketball on {app}.', audience: 'all', tags: ['basketball', 'game day'] }),

  T({ id: 'nba-playoffs', category: 'basketball', name: 'Playoffs push', badge: 'Tournament', accent: '#c2410c',
    title: 'The playoffs are on — every game matters', description: 'Tournament campaign for the basketball playoffs and conference finals.',
    subject: 'Playoff basketball is here 🏀🔥',
    html: mail({ title: 'Every game matters now', intro: 'The playoffs are here, {name}. Series go to seven and every possession counts. Watch them all on {app}.', points: ['Every playoff game live', 'Replays and full highlights', 'Playoffs offer: code {code} for {discount}% off'], cta: 'Watch the playoffs', code: '{code}', accent: '#c2410c' }),
    whatsapp: '🏀🔥 *Playoffs are here*\nHi {name}, every game matters now. Watch all playoff basketball live on {app}. Code {code} = {discount}% off.\n\n▶️ {trial}',
    notifTitle: '🏀 Playoffs', notifBody: 'Playoff basketball is live on {app}. Do not miss a game.', audience: 'all', tags: ['basketball', 'playoffs', 'tournament'] }),

  T({ id: 'nba-finals', category: 'basketball', name: 'Finals weekend', badge: 'Seasonal', accent: '#b91c1c',
    title: 'Finals weekend — witness the crown', description: 'Seasonal, high-urgency campaign for the basketball finals.',
    subject: 'The finals are here 🏆🏀',
    html: mail({ title: 'One series. One champion.', intro: 'The finals are here, {name}. Watch every dribble, dunk and defining moment live on {app}.', points: ['All finals games live in HD', 'Pre-game and post-game coverage', 'Finals-week offer: {discount}% off with {code}'], cta: 'Watch the finals', code: '{code}', accent: '#b91c1c' }),
    whatsapp: '🏆🏀 *Finals weekend*\nHi {name}, the finals are here! Watch every game live on {app}. Code {code} = {discount}% off.\n\n▶️ {trial}',
    notifTitle: '🏆 Finals', notifBody: 'The basketball finals are live on {app}.', audience: 'all', tags: ['basketball', 'finals', 'seasonal'] }),

  T({ id: 'basketball-season', category: 'basketball', name: 'Season tip-off', badge: 'Seasonal', accent: '#d97706',
    title: 'A new basketball season tips off', description: 'Season-opening campaign to bring back lapsed viewers and attract new ones.',
    subject: 'Basketball season is back 🏀',
    html: mail({ title: 'Tip-off of a new season', intro: 'The new basketball season starts now, {name}. Follow every team from opening night to the last game.', points: ['Every game of the new season', 'On-demand replays whenever you want', 'Season-opener code {code} for {discount}% off'], cta: 'Get season-ready', code: '{code}', accent: '#d97706' }),
    whatsapp: '🏀 *New season, tip-off now*\nHi {name}, the basketball season is back on {app}. Code {code} = {discount}% off.\n\n▶️ {trial}',
    notifTitle: '🏀 Season tip-off', notifBody: 'Basketball is back on {app}. Get season-ready.', audience: 'expired', tags: ['basketball', 'season'] }),

  // ---------------- Reseller ----------------
  T({ id: 'reseller-credit-bundle', category: 'reseller', name: 'Credit bundle bonus', badge: 'Reseller', accent: '#6d28d9',
    title: 'Buy a credit bundle, get extra credits', description: 'Offer resellers a bonus when they purchase a credit pack in a limited window.',
    subject: 'Extra credits on your next bundle 🎁',
    html: mail({ title: 'More credits, more margin', intro: 'Hi {name}, top up your reseller credit bundle during this window and we will add {credit} bonus credits on top.', points: ['Bonus {credit} credits on every eligible bundle', 'Credits land in your reseller panel instantly', 'Limited-time: ends soon'], cta: 'Buy credit bundle', code: '{code}', accent: '#6d28d9' }),
    whatsapp: '🤝 *Reseller credit bonus*\nHi {name}, get +{credit} bonus credits on your next credit bundle at {app}. Code {code}.\n\n💬 Support: {support}',
    notifTitle: '🎁 Reseller bonus', notifBody: 'Buy a credit bundle and get +{credit} bonus credits.', audience: 'resellers', tags: ['reseller', 'credit', 'bonus'] }),

  T({ id: 'reseller-recharge', category: 'reseller', name: 'Recharge bonus', badge: 'Reseller', accent: '#4f46e5',
    title: 'Recharge now and stretch your margin', description: 'Recharge campaign for resellers with a bonus percentage on top-ups.',
    subject: 'Recharge bonus: +{bonus}% credits ⚡',
    html: mail({ title: 'Your recharge, boosted', intro: 'Hi {name}, recharge your reseller wallet this week and receive a {bonus}% credit bonus automatically.', points: ['+{bonus}% on every recharge', 'Instant credit in your panel', 'No code needed — applied automatically'], cta: 'Recharge now', accent: '#4f46e5' }),
    whatsapp: '⚡ *Reseller recharge bonus*\nHi {name}, recharge your wallet at {app} this week and get +{bonus}% credits automatically.\n\n💬 {support}',
    notifTitle: '⚡ Recharge bonus', notifBody: 'Recharge this week and get +{bonus}% bonus credits.', audience: 'resellers', tags: ['reseller', 'recharge', 'bonus'] }),

  T({ id: 'reseller-exclusive', category: 'reseller', name: 'Exclusive reseller deal', badge: 'VIP', accent: '#0f766e',
    title: 'An exclusive deal, just for resellers', description: 'VIP-style exclusive campaign with a special discount on reseller packages.',
    subject: 'Exclusive reseller offer, {name} 🔒',
    html: mail({ title: 'Reserved for resellers', intro: 'Hi {name}, here is an exclusive deal we are only extending to our reseller partners: {discount}% off your next credit purchase.', points: ['Reseller partners only', '{discount}% off with code {code}', 'Stacks with your existing rates'], cta: 'Claim exclusive deal', code: '{code}', accent: '#0f766e' }),
    whatsapp: '🔒 *Exclusive reseller deal*\nHi {name}, use code {code} for {discount}% off your next credit purchase at {app}. Partners only.',
    notifTitle: '🔒 Exclusive deal', notifBody: 'A reseller-only deal is waiting: {discount}% off with code {code}.', audience: 'resellers', tags: ['reseller', 'exclusive', 'vip'] }),

  T({ id: 'reseller-bulk-lines', category: 'reseller', name: 'Bulk lines campaign', badge: 'Campaign', accent: '#7c3aed',
    title: 'Grow your book with bulk-line pricing', description: 'Campaign encouraging resellers to buy larger line bundles with a volume discount.',
    subject: 'Better rates on bigger bundles 📈',
    html: mail({ title: 'Scale up with bulk lines', intro: 'Hi {name}, the more lines you add, the better your margin. Ask about our bulk-line pricing and get {discount}% off this month.', points: ['Volume pricing on larger bundles', 'Fast activation for every line', 'Dedicated support for partners'], cta: 'Talk to us', code: '{code}', url: '{support}', accent: '#7c3aed' }),
    whatsapp: '📈 *Bulk lines campaign*\nHi {name}, scale up with better bulk-line rates at {app}. Code {code} = {discount}% off this month.',
    notifTitle: '📈 Bulk lines', notifBody: 'Better rates on bigger line bundles this month.', audience: 'resellers', tags: ['reseller', 'bulk', 'campaign'] }),

  // ---------------- Credit ----------------
  T({ id: 'double-credit', category: 'credit', name: 'Double credit hours', badge: 'Limited time', accent: '#0891b2',
    title: 'Double credits — this weekend only', description: 'A limited-time deal doubling the credits customers receive on a purchase.',
    subject: 'Double credits this weekend ⏱️',
    html: mail({ title: 'Double credits, this weekend only', intro: 'Hi {name}, for a limited time every credit pack comes with {credit} extra credits. Top up while the clock is ticking.', points: ['+{credit} bonus credits on every pack', 'Credited instantly', 'Ends Sunday — no extensions'], cta: 'Get double credits', code: '{code}', accent: '#0891b2' }),
    whatsapp: '⏱️ *Double credit hours*\nHi {name}, get +{credit} bonus credits on every pack this weekend at {app}. Code {code}.',
    notifTitle: '⏱️ Double credits', notifBody: 'Double credits this weekend only. Top up now.', audience: 'all', tags: ['credit', 'limited time', 'bonus'] }),

  T({ id: 'extra-credit-pack', category: 'credit', name: 'Extra-credit package', badge: 'Package', accent: '#2563eb',
    title: 'More viewing, more value: extra-credit packs', description: 'Promote a package that bundles extra credits with a subscription.',
    subject: 'Extra-credit packs are here 🎟',
    html: mail({ title: 'More credits, more freedom', intro: 'Hi {name}, our new extra-credit pack gives you {credit} credits to spend however you like, on top of your plan.', points: ['{credit} credits to use anytime', 'Works with every plan', 'Save {discount}% with code {code}'], cta: 'See credit packs', code: '{code}', accent: '#2563eb' }),
    whatsapp: '🎟 *Extra-credit pack*\nHi {name}, get {credit} credits to spend anytime at {app}. Code {code} = {discount}% off.',
    notifTitle: '🎟 Extra credits', notifBody: 'New extra-credit packs are here. Get {credit} credits.', audience: 'active', tags: ['credit', 'package'] }),

  T({ id: 'credit-loyalty', category: 'credit', name: 'Loyalty credit reward', badge: 'Loyalty', accent: '#7e22ce',
    title: 'Thank you — here are loyalty credits', description: 'Reward long-standing customers with free loyalty credits.',
    subject: 'A thank-you gift for you 💜',
    html: mail({ title: 'Thanks for sticking with us', intro: 'Hi {name}, loyalty deserves a reward. Enjoy {credit} free credits on us as a thank-you for being with {app}.', points: ['{credit} free credits, added automatically', 'No purchase needed', 'Valid until the end of the month'], cta: 'See your credits', accent: '#7e22ce' }),
    whatsapp: '💜 *Loyalty reward*\nHi {name}, thanks for being with {app}. Enjoy {credit} free credits on us!',
    notifTitle: '💜 Loyalty reward', notifBody: 'You have {credit} free credits waiting. Thank you for being with us.', audience: 'paying', tags: ['credit', 'loyalty', 'reward'] }),

  T({ id: 'credit-recharge-bonus', category: 'credit', name: 'Recharge & get bonus', badge: 'Recharge', accent: '#0284c7',
    title: 'Top up and we add {bonus}% more', description: 'A straightforward recharge-bonus offer with a configurable bonus percentage.',
    subject: 'Top up and get +{bonus}% credits 🔁',
    html: mail({ title: 'Your top-up, with a bonus', intro: 'Hi {name}, recharge your {app} balance and we will add {bonus}% extra credits instantly.', points: ['+{bonus}% on every top-up', 'Instant, automatic credit', 'Use code {code} at checkout'], cta: 'Top up now', code: '{code}', accent: '#0284c7' }),
    whatsapp: '🔁 *Recharge bonus*\nHi {name}, top up at {app} and get +{bonus}% credits. Code {code}.',
    notifTitle: '🔁 Recharge bonus', notifBody: 'Top up now and get +{bonus}% extra credits.', audience: 'all', tags: ['credit', 'recharge', 'bonus'] }),

  T({ id: 'credit-purchase-offer', category: 'credit', name: 'Special purchase offer', badge: 'Offer', accent: '#be123c',
    title: 'A special offer on your next purchase', description: 'A general purchase offer with a discount and a bonus-credit kicker.',
    subject: 'A special purchase offer for you 🎁',
    html: mail({ title: 'Something special for you', intro: 'Hi {name}, take {discount}% off your next purchase at {app} and receive {credit} bonus credits as a thank-you.', points: ['{discount}% off with code {code}', '+{credit} bonus credits', 'One use per account'], cta: 'Claim this offer', code: '{code}', accent: '#be123c' }),
    whatsapp: '🎁 *Special purchase offer*\nHi {name}, get {discount}% off with code {code} plus {credit} bonus credits at {app}.',
    notifTitle: '🎁 Special offer', notifBody: 'Take {discount}% off and get {credit} bonus credits on your next purchase.', audience: 'all', tags: ['credit', 'offer', 'discount'] }),
]);

export const promoTemplate = (id) => PROMO_TEMPLATES.find((x) => x.id === id) || null;
