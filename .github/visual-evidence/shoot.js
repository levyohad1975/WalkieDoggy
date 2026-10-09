// TEMPORARY (validation branch only): renders the exported web build in demo
// mode and captures Family Chat screenshots + layout measurements.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT_DIR || 'evidence';
const at = (h, m, d = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
const mk = (id, sender, body, when, extra = {}) => ({ id, conversationId: 'local-family-chat:family-main', familyId: 'family-main', senderUserId: sender, body, createdAt: when, delivery: 'sent', ...extra });
const seedMessages = [
  mk('s1', 'user-ima', 'מי מוציא את טופי הערב? אני תקועה בעבודה עד שבע', at(18, 40, -1)),
  mk('s2', 'user-aba', 'אני אוציא אותו בשש וחצי', at(18, 42, -1)),
  mk('s3', 'user-eidan', 'Back from practice at 17:30, I can take the evening walk 🐶', at(8, 5)),
  mk('s4', 'user-eidan', 'אבל צריך שמישהו יזכיר לי איפה הרצועה', at(8, 6)),
  mk('s5', 'user-omer', '', at(8, 20), { deletedAt: at(8, 30), deletedByUserId: 'user-aba' }),
  mk('s6', 'user-aba', 'הרצועה במגירה ליד הדלת. Thanks Eidan!', at(8, 31)),
  mk('s7', 'user-ima', 'טופי אכל את כל האוכל בבוקר, אין צורך להוסיף', at(9, 12)),
  mk('s8', 'user-maor', 'אפשר להחליף איתי מחר בבוקר?', at(9, 40)),
];
const CHAT_TAB = '[aria-label^="צ׳אט"]';
const INPUT = 'textarea[aria-label="הודעה חדשה לצ׳אט המשפחתי"]';
const SEND = '[aria-label="שליחת ההודעה"]';

async function open(browser, { width, height, mobile, seed, lastRead }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: !!mobile,
    hasTouch: !!mobile,
    locale: 'he-IL',
    userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : undefined,
  });
  await ctx.addInitScript(({ seed, lastRead }) => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    localStorage.setItem('dog-walk-family:current-user-id', 'user-aba');
    localStorage.setItem('walkie-ios-install-prompt-dismissed', '1');
    if (seed) localStorage.setItem('walkie-doggy/chat/family-main', JSON.stringify({ messages: seed, lastReadAt: { 'user-aba': lastRead }, muted: {} }));
  }, { seed, lastRead });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForSelector(CHAT_TAB, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}
const shot = (page, file) => page.screenshot({ path: `${OUT}/${file}.jpg`, type: 'jpeg', quality: 72 });

async function navReport(page) {
  return page.evaluate(() => {
    const out = [];
    for (const label of ['הגדרות', 'נתונים', 'משפחה', 'בית', 'צ׳אט', 'לו״ז', 'היסטוריה']) {
      const btn = [...document.querySelectorAll('[role=button]')].find((b) => (b.getAttribute('aria-label') || '').startsWith(label));
      if (!btn) { out.push(label + ': MISSING'); continue; }
      const texts = [...btn.querySelectorAll('div')].filter((d) => d.children.length === 0 && d.textContent.trim() === label);
      const t = texts[texts.length - 1];
      const r = btn.getBoundingClientRect();
      const range = document.createRange(); if (t) range.selectNodeContents(t);
      const tw = t ? Math.round(range.getBoundingClientRect().width * 10) / 10 : -1;
      const bw = t ? Math.round(t.getBoundingClientRect().width * 10) / 10 : -1;
      out.push(`${label}: button x=${Math.round(r.left)}..${Math.round(r.right)} w=${Math.round(r.width)} bottom=${Math.round(r.bottom)} | labelText=${tw}px labelBox=${bw}px clipped=${t ? tw > bw + 0.5 : '?'}`);
    }
    out.push(`viewport=${innerWidth}x${innerHeight} horizontalOverflow=${document.documentElement.scrollWidth > innerWidth}`);
    return out;
  });
}
async function chatReport(page) {
  return page.evaluate(() => {
    const pick = (txt) => [...document.querySelectorAll('div')].filter((d) => d.children.length === 0 && d.textContent.includes(txt)).pop();
    const rep = (name, txt) => { const el = pick(txt); if (!el) return name + ': MISSING'; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return `${name}: x=${Math.round(r.left)}..${Math.round(r.right)} direction=${cs.direction} textAlign=${cs.textAlign}`; };
    const composer = document.querySelector('textarea');
    const cr = composer ? composer.getBoundingClientRect() : null;
    return [
      rep('theirs-hebrew', 'טופי אכל'),
      rep('theirs-english', 'Back from practice'),
      rep('mine-mixed', 'Thanks Eidan'),
      rep('removed', 'ההודעה הוסרה'),
      rep('unread-divider', 'הודעות חדשות'),
      `composer: ${cr ? `y=${Math.round(cr.top)}..${Math.round(cr.bottom)} of ${innerHeight}` : 'MISSING'}`,
      `horizontalOverflow=${document.documentElement.scrollWidth > innerWidth}`,
      'chatTabLabelAfterOpen=' + [...document.querySelectorAll('[role=button]')].find((b) => (b.getAttribute('aria-label') || '').startsWith('צ׳אט')).getAttribute('aria-label'),
    ];
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const log = [];
  const iphone = { width: 390, height: 844, mobile: true };

  let s = await open(browser, { ...iphone, seed: seedMessages, lastRead: at(8, 10) });
  await shot(s.page, '01-iphone-home-with-unread-badge');
  log.push('## iPhone 390x844 — tab bar', ...(await navReport(s.page)));
  log.push('chatTabLabelBeforeOpen=' + (await s.page.getAttribute(CHAT_TAB, 'aria-label')));
  await s.page.click(CHAT_TAB);
  await s.page.waitForTimeout(1800);
  await shot(s.page, '02-iphone-chat-conversation');
  log.push('## iPhone 390x844 — chat', ...(await chatReport(s.page)));
  await s.page.locator(INPUT).fill('בטח מאור, אני אקח את הבוקר של מחר');
  await s.page.waitForTimeout(400);
  await shot(s.page, '03-iphone-composing');
  await s.page.click(SEND);
  await s.page.waitForTimeout(1200);
  await shot(s.page, '04-iphone-message-sent');
  await s.page.locator(INPUT).fill('שורה ראשונה\nשורה שנייה\nשורה שלישית\nMixed עברית and English in one message');
  await s.page.waitForTimeout(400);
  await shot(s.page, '05-iphone-multiline-draft');
  await s.page.locator(INPUT).fill('');
  await s.page.click('text=אפשר להחליף איתי');
  await s.page.waitForTimeout(500);
  await shot(s.page, '06-iphone-manager-moderation');
  await s.page.click('[aria-label="מחיקת ההודעה לכל בני המשפחה"]');
  await s.page.waitForTimeout(600);
  await shot(s.page, '07-iphone-delete-confirmation');
  await s.page.click('text=ביטול');
  await s.page.waitForTimeout(400);
  await s.ctx.setOffline(true);
  await s.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await s.page.waitForTimeout(900);
  await s.page.locator(INPUT).fill('הודעה בלי קליטה');
  await s.page.click(SEND);
  await s.page.waitForTimeout(800);
  await shot(s.page, '08-iphone-offline-unsent');
  log.push('iphone console errors: ' + JSON.stringify(s.errors.slice(0, 6)));
  await s.ctx.close();

  s = await open(browser, { ...iphone, seed: null });
  await s.page.click(CHAT_TAB);
  await s.page.waitForTimeout(1500);
  await shot(s.page, '09-iphone-empty-state');
  await s.ctx.close();

  s = await open(browser, { width: 320, height: 568, mobile: true, seed: seedMessages, lastRead: at(8, 10) });
  log.push('## Small phone 320x568 — tab bar', ...(await navReport(s.page)));
  await s.page.click(CHAT_TAB);
  await s.page.waitForTimeout(1500);
  await shot(s.page, '10-small-phone-320-chat');
  await s.ctx.close();

  s = await open(browser, { width: 360, height: 780, mobile: true, seed: seedMessages, lastRead: at(8, 10) });
  log.push('## Android 360x780 — tab bar', ...(await navReport(s.page)));
  await s.page.click(CHAT_TAB);
  await s.page.waitForTimeout(1500);
  await shot(s.page, '11-android-360-chat');
  await s.ctx.close();

  s = await open(browser, { width: 1440, height: 900, mobile: false, seed: seedMessages, lastRead: at(8, 10) });
  log.push('## Desktop 1440x900 — tab bar', ...(await navReport(s.page)));
  await s.page.click(CHAT_TAB);
  await s.page.waitForTimeout(1800);
  await shot(s.page, '12-desktop-chat');
  log.push('## Desktop 1440x900 — chat', ...(await chatReport(s.page)));
  log.push('desktop console errors: ' + JSON.stringify(s.errors.slice(0, 6)));
  await s.ctx.close();

  s = await open(browser, { width: 768, height: 1024, mobile: false, seed: seedMessages, lastRead: at(8, 10) });
  await s.page.click(CHAT_TAB);
  await s.page.waitForTimeout(1500);
  await shot(s.page, '13-tablet-768-chat');
  await s.ctx.close();

  await browser.close();
  fs.writeFileSync(`${OUT}/layout-measurements.txt`, log.join('\n') + '\n');
  console.log(log.join('\n'));
})().catch((e) => { console.error('SHOOT FAILED', e); process.exit(1); });
