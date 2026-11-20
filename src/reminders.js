// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// Email reminder routes + the hourly sender. Rules and copy live in lib/remind.js.
//   POST /api/c/<slug>/remind   sign up (sends one confirm email)
//   GET|POST /r/yes/<token>     confirm page (the button POSTs, so link scanners can't confirm)
//   GET|POST /r/stop/<token>    stop page, plus RFC 8058 one-click unsubscribe
//   GET /api/admin/c/<slug>/signups   counts + the newsletter list (CSV download in /admin)

import {
  SUB_CAP, CONFIRM_DAILY_CAP, CONFIRM_DAYS, CONFIRM_RESEND_MS,
  cleanEmail, validTz, dueDay, signupsOpen, purgeAfter, confirmEmail, doorEmail, newsletterName,
  capAlertLevel, capAlertEmail, ipBucket, newSignupEmail, SIGNUP_ALERT_DAILY_CAP,
} from './lib/remind.js';

// Sender, alerts and links all come from wrangler.toml settings. See README.md.
function adminUrl(env) { return `${env.APP_URL}/admin/`; }

function utcDay(nowMs) { return new Date(nowMs).toISOString().slice(0, 10); }

// Visitor IPs are only ever stored keyed with a secret (a plain hash of an IPv4
// address can be reversed by trying them all), and the rows are deleted after 2 days.
async function ipHash(env, s) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('ip-key:' + (env.JWT_SECRET || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// One counter row per UTC day. Returns false once today's cap is used up.
async function takeBudget(env, key, cap, nowMs) {
  const day = utcDay(nowMs);
  await env.DB.prepare('INSERT OR IGNORE INTO rate_limits (k, day, n) VALUES (?, ?, 0)').bind(key, day).run();
  const r = await env.DB.prepare('UPDATE rate_limits SET n = n + 1 WHERE k = ? AND day = ? AND n < ?').bind(key, day, cap).run();
  return (r.meta && r.meta.changes) > 0;
}
async function giveBackBudget(env, key, nowMs) {
  await env.DB.prepare('UPDATE rate_limits SET n = MAX(n - 1, 0) WHERE k = ? AND day = ?').bind(key, utcDay(nowMs)).run();
}

async function sendEmail(env, { to, fromName, subject, html, text, stopUrl, idempotencyKey }) {
  // Every email must carry your postal address (anti-spam law), so no address = no email.
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.MAIL_ADDRESS) { console.error('RESEND_API_KEY, EMAIL_FROM or MAIL_ADDRESS missing'); return false; }
  const FROM_ADDR = env.EMAIL_FROM;
  const headers = { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const payload = { from: `${fromName} <${FROM_ADDR}>`, to: [to], reply_to: FROM_ADDR, subject, html, text };
  if (stopUrl) payload.headers = { 'List-Unsubscribe': `<${stopUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!r.ok) console.error('resend failed', r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) {
    console.error('resend threw', e && e.message);
    return false;
  }
}

// Display name on the emails: EMAIL_FROM_NAME, or the calendar's own title. Quotes and angle brackets are dropped.
function fromName(cal, env) { return String((env && env.EMAIL_FROM_NAME) || cal.title).replace(/["<>\r\n]/g, '').slice(0, 60); }
function calUrl(env, cal) { return `${env.APP_URL}/c/${cal.slug}`; }
async function stopUrl(env, d, cal, subId) {
  const tok = await d.signToken({ k: 'rs', u: subId, exp: Math.floor(purgeAfter(cal.year) / 1000) }, env.JWT_SECRET);
  return `${env.APP_URL}/r/stop/${tok}`;
}

async function confirmedCount(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM reminder_subs WHERE status = 'confirmed'").first();
  return (r && r.n) || 0;
}

// ---------------------------------------------------------------------------
// Sign-up

export async function handleSignup(request, env, slug, now, d) {
  // Only the calendar page itself may sign people up, so another site can't post
  // the form through its own visitors' browsers.
  if (request.headers.get('Origin') !== env.APP_URL) return d.err('Not allowed', 403);
  const ipKey = await ipHash(env, 'signup:' + ipBucket(d.clientIp(request)));
  if (!d.rateLimit('remind:' + ipKey, 5, 60 * 60 * 1000, now)) return d.err('Too many tries. Give it an hour and try again.', 429);
  const { body, resp } = await d.bodyOr(request);
  if (resp) return resp;

  const cal = await d.loadCalendar(env, slug);
  const pv = await d.verifyToken(String(body.preview || ''), env.JWT_SECRET);
  const preview = !!pv && !!cal && pv.pv === slug && pv.c === (cal.created_at || 0);
  if (!cal || cal.demo || (!cal.published && !preview)) return d.err('Not found', 404);
  if (!signupsOpen(cal.year, now)) return d.json({ closed: true });
  // No email set up means no sign-ups: nothing is stored and nothing is sent.
  if (!d.emailReady(env)) return d.json({ off: true });

  // A filled-in hidden field means a bot. Say yes and do nothing.
  if (body.website) return d.json({ ok: true });
  if (env.TURNSTILE_SECRET && env.TURNSTILE_SITEKEY && !(await turnstileOk(env, body.ts, d.clientIp(request)))) {
    return d.err("We couldn't check you're a person. Tick the box and try again.", 400);
  }

  const email = cleanEmail(body.email);
  if (!email) return d.err("That email doesn't look right. Check it and try again.");
  const launch = body.launch ? 1 : 0;
  const daily = body.daily ? 1 : 0;
  // The newsletter box only exists when NEWSLETTER_NAME is set.
  const newsletter = env.NEWSLETTER_NAME && body.newsletter ? 1 : 0;
  if (!launch && !daily) return d.err('Pick at least one reminder.');
  const tz = validTz(body.tz) ? body.tz : 'America/Chicago';

  if (!(await takeBudget(env, ipKey.slice(0, 32), 10, now))) return d.err('Too many tries today. Try again tomorrow.', 429);

  // Only confirmed people hold a spot, so unconfirmed (or fake) sign-ups can't fill
  // the list. Checked the same way for every address, so the answer never hints
  // at whether an address is already signed up.
  if ((await confirmedCount(env)) >= SUB_CAP) return d.json({ full: true });
  let row = await env.DB.prepare('SELECT id, status, confirm_sent_at FROM reminder_subs WHERE calendar_slug = ? AND email = ?').bind(slug, email).first();
  if (!row) {
    await env.DB.prepare('INSERT OR IGNORE INTO reminder_subs (calendar_slug, email, tz, created_at) VALUES (?, ?, ?, ?)').bind(slug, email, tz, now).run();
    row = await env.DB.prepare('SELECT id, status, confirm_sent_at FROM reminder_subs WHERE calendar_slug = ? AND email = ?').bind(slug, email).first();
  }
  // Same answer whether or not the address was already signed up, so the form
  // can't be used to check who is on the list.
  if (row.confirm_sent_at > now - CONFIRM_RESEND_MS) return d.json({ ok: true });

  // Each visitor gets 2 confirm emails a day, well under the shared 10, so one
  // person can't use up everyone's sign-ups.
  if (!(await takeBudget(env, 'c' + ipKey.slice(0, 31), 2, now))) return d.err('Too many sign-ups from here today. Try again tomorrow.', 429);
  if (!(await takeBudget(env, 'email-confirm', CONFIRM_DAILY_CAP, now))) return d.json({ busy: true });
  const tok = await d.signToken({ k: 'ry', u: row.id, s: slug, l: launch, d: daily, n: newsletter, tz, exp: Math.floor(now / 1000) + CONFIRM_DAYS * 86400 }, env.JWT_SECRET);
  const msg = confirmEmail({ calTitle: cal.title, newsletterTitle: env.NEWSLETTER_NAME, address: env.MAIL_ADDRESS, launch, daily, newsletter, confirmUrl: `${env.APP_URL}/r/yes/${tok}` });
  const sent = await sendEmail(env, { to: email, fromName: fromName(cal, env), ...msg });
  if (!sent) {
    await giveBackBudget(env, 'email-confirm', now);
    return d.err("We couldn't send the email just now. Try again in a few minutes.", 502);
  }
  await env.DB.prepare('UPDATE reminder_subs SET confirm_sent_at = ? WHERE id = ?').bind(now, row.id).run();
  return d.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Confirm + stop pages. Small server-rendered pages in the calendar's own look.

function page(d, { theme, title, body, status = 200 }) {
  const html = `<!doctype html><html lang="en" data-theme="${theme || 'workshop'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${d.esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Figtree:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/calendar.css?v=11"></head>
<body><div class="wrap"><main id="main"><section class="msg-page"><div class="msg-card">${body}</div></section></main></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...d.secHeaders({ noindex: true }) } });
}

async function subAndCal(env, id) {
  const sub = await env.DB.prepare('SELECT * FROM reminder_subs WHERE id = ?').bind(id).first();
  if (!sub) return {};
  const cal = await env.DB.prepare('SELECT slug, title, theme, year FROM calendars WHERE slug = ?').bind(sub.calendar_slug).first();
  return { sub, cal };
}

export async function handleConfirm(request, env, token, now, d) {
  const t = await d.verifyToken(token, env.JWT_SECRET);
  const { sub, cal } = t && t.k === 'ry' ? await subAndCal(env, t.u) : {};
  if (!sub || !cal || sub.calendar_slug !== t.s) {
    return page(d, { title: 'Link expired', status: 400, body: '<h2>This link has expired</h2><p>Confirm links work for a week. Sign up again from the calendar and we\'ll send a fresh one.</p>' });
  }
  const action = `/r/yes/${d.esc(token)}`;
  if (request.method === 'POST') {
    // One statement, so two confirms at the same moment can't both squeeze past the cap.
    const upd = await env.DB.prepare("UPDATE reminder_subs SET status = 'confirmed', want_launch = ?, want_daily = ?, want_newsletter = ?, tz = ?, confirmed_at = ?, unsubscribed_at = 0 WHERE id = ? AND (status = 'confirmed' OR (SELECT COUNT(*) FROM reminder_subs WHERE status = 'confirmed') < ?)")
      .bind(t.l ? 1 : 0, t.d ? 1 : 0, t.n ? 1 : 0, validTz(t.tz) ? t.tz : sub.tz, now, sub.id, SUB_CAP).run();
    if (!(upd.meta && upd.meta.changes)) {
      return page(d, { theme: cal.theme, title: 'Reminders are full', body: `<h2>Sorry, reminders filled up</h2><p>Email reminders for this year filled up before you confirmed. The calendar has buttons to add a daily reminder to your own phone calendar instead.</p><a class="btn" href="/c/${d.esc(cal.slug)}">Go to the calendar</a>` });
    }
    // Tell the owner (ALERT_EMAIL), only the first time this person confirms.
    if (sub.status !== 'confirmed') await signupAlert(env, now, cal, sub.email, t);
    const got = [];
    if (t.l || t.d) got.push(t.d ? 'an email each morning when a new door opens, December 1 to 24' : 'an email when the calendar opens on December 1');
    if (t.n) got.push(`${newsletterName(env.NEWSLETTER_NAME)}, which starts once it's added`);
    return page(d, { theme: cal.theme, title: "You're all set", body: `<h2>You're all set</h2><p>You'll get ${d.esc(got.join(', plus '))}.</p><p>Every email has a link to stop them.</p><a class="btn" href="/c/${d.esc(cal.slug)}">Go to the calendar</a>` });
  }
  return page(d, { theme: cal.theme, title: 'Confirm your reminders', body: `<h2>Confirm your reminders</h2><p>For ${d.esc(cal.title)}. Tap the button and you're set.</p><form method="post" action="${action}"><button class="btn" type="submit">Yes, send my reminders</button></form>` });
}

export async function handleStop(request, env, token, now, d) {
  const t = await d.verifyToken(token, env.JWT_SECRET);
  const { sub, cal } = t && t.k === 'rs' ? await subAndCal(env, t.u) : {};
  if (!sub || !cal) return page(d, { title: 'Not found', status: 404, body: '<h2>We couldn\'t find that sign-up</h2><p>It may already be gone. Advent emails stop on their own after December 24.</p>' });
  if (request.method === 'POST') {
    await env.DB.prepare("UPDATE reminder_subs SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?").bind(now, sub.id).run();
    // A mail app's one-click unsubscribe posts here and only needs a 200.
    const ct = request.headers.get('Content-Type') || '';
    if (ct.includes('application/x-www-form-urlencoded') && (await request.clone().text()).includes('List-Unsubscribe=One-Click')) {
      return new Response('Unsubscribed', { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', ...d.secHeaders({ noindex: true }) } });
    }
    return page(d, { theme: cal.theme, title: 'Emails stopped', body: `<h2>Done. No more advent emails.</h2><p>You won't get any more emails from ${d.esc(cal.title)}. The calendar is still yours to open any time.</p><a class="btn" href="/c/${d.esc(cal.slug)}">Go to the calendar</a>` });
  }
  if (sub.status === 'unsubscribed') return page(d, { theme: cal.theme, title: 'Emails stopped', body: `<h2>You're already off the list</h2><p>No more emails from ${d.esc(cal.title)} will come.</p>` });
  return page(d, { theme: cal.theme, title: 'Stop advent emails', body: `<h2>Stop these emails?</h2><p>You'll get no more reminder emails from ${d.esc(cal.title)}.</p><form method="post" action="/r/stop/${d.esc(token)}"><button class="btn" type="submit">Stop my emails</button></form>` });
}

// ---------------------------------------------------------------------------
// Admin: who signed up. The /admin page turns the newsletter list into a CSV for your newsletter tool.

// When each calendar's newsletter list was last downloaded, so the next download
// can hold only the people who are new since then.
const EXPORTS_TABLE = 'CREATE TABLE IF NOT EXISTS newsletter_exports (calendar_slug TEXT PRIMARY KEY, last_confirmed_at INTEGER NOT NULL DEFAULT 0, downloaded_at INTEGER NOT NULL DEFAULT 0)';

async function lastExport(env, slug) {
  await env.DB.prepare(EXPORTS_TABLE).run();
  return (await env.DB.prepare('SELECT last_confirmed_at, downloaded_at FROM newsletter_exports WHERE calendar_slug = ?').bind(slug).first()) || { last_confirmed_at: 0, downloaded_at: 0 };
}

// The /admin page calls this after a "new people" download. upto = the newest
// confirmed_at in that file, so anyone confirming mid-download still counts as new.
export async function handleSignupsExported(request, env, slug, now) {
  let body = {};
  try { body = await request.json(); } catch { return { error: 'Bad request', status: 400 }; }
  const upto = Number(body.upto);
  if (!Number.isFinite(upto) || upto < 0 || upto > now) return { error: 'Bad request', status: 400 };
  await env.DB.prepare(EXPORTS_TABLE).run();
  await env.DB.prepare('INSERT INTO newsletter_exports (calendar_slug, last_confirmed_at, downloaded_at) VALUES (?, ?, ?) ON CONFLICT(calendar_slug) DO UPDATE SET last_confirmed_at = MAX(last_confirmed_at, excluded.last_confirmed_at), downloaded_at = excluded.downloaded_at')
    .bind(slug, Math.floor(upto), now).run();
  return { ok: true, ...(await lastExport(env, slug)) };
}

export async function handleSignupsAdmin(env, slug) {
  const last = await lastExport(env, slug);
  const r = await env.DB.prepare('SELECT email, status, want_launch, want_daily, want_newsletter, created_at, confirmed_at FROM reminder_subs WHERE calendar_slug = ? ORDER BY created_at DESC').bind(slug).all();
  const rows = r.results || [];
  const confirmed = rows.filter((x) => x.status === 'confirmed');
  return {
    confirmed: confirmed.length,
    daily: confirmed.filter((x) => x.want_daily).length,
    launch_only: confirmed.filter((x) => x.want_launch && !x.want_daily).length,
    pending: rows.filter((x) => x.status === 'pending').length,
    stopped: rows.filter((x) => x.status === 'unsubscribed').length,
    cap: SUB_CAP,
    newsletter: confirmed.filter((x) => x.want_newsletter).map((x) => ({ email: x.email, confirmed_at: x.confirmed_at })),
    last_download: last.downloaded_at, last_confirmed_at: last.last_confirmed_at,
    // Everyone, newest first, to see who's joining. A pending row's choices
    // aren't saved until they confirm, so they show as "not confirmed yet".
    people: rows.map((x) => ({
      email: x.email, status: x.status, signed_up: x.created_at,
      launch: !!x.want_launch, daily: !!x.want_daily, newsletter: !!x.want_newsletter,
    })),
  };
}

// ---------------------------------------------------------------------------
// Hourly: send whatever door email is due, within today's budget. Then the purge.

export async function runReminders(env, now, d) {
  // The Feb 1 deletion promise covers every calendar, hidden or not, and sign-ups
  // whose calendar was deleted.
  const all = (await env.DB.prepare('SELECT slug, year FROM calendars').all()).results || [];
  for (const c of all) {
    if (now >= purgeAfter(c.year)) await env.DB.prepare('DELETE FROM reminder_subs WHERE calendar_slug = ?').bind(c.slug).run();
  }
  await env.DB.prepare('DELETE FROM reminder_subs WHERE calendar_slug NOT IN (SELECT slug FROM calendars)').run();
  // Rate-limit counters only matter for a day. The one-time alert flags stay.
  await env.DB.prepare("DELETE FROM rate_limits WHERE day <> 'once' AND day < ?").bind(utcDay(now - 2 * 86400000)).run();

  const cals = (await env.DB.prepare('SELECT slug, title, theme, year FROM calendars WHERE published = 1 AND demo = 0').all()).results || [];
  let sent = 0, skipped = 0;
  for (const cal of cals) {
    if (now >= purgeAfter(cal.year)) continue;
    const subs = (await env.DB.prepare("SELECT * FROM reminder_subs WHERE calendar_slug = ? AND status = 'confirmed' AND last_sent_day < 24").bind(cal.slug).all()).results || [];
    for (const sub of subs) {
      const day = dueDay(sub, cal.year, now);
      if (!day) continue;
      // Claim the day first, so an overlapping run can't send it twice.
      const claim = await env.DB.prepare('UPDATE reminder_subs SET last_sent_day = ? WHERE id = ? AND last_sent_day < ?').bind(day, sub.id, day).run();
      if (!(claim.meta && claim.meta.changes)) continue;
      if (!(await takeBudget(env, 'email-send', SUB_CAP, now))) {
        await env.DB.prepare('UPDATE reminder_subs SET last_sent_day = ? WHERE id = ?').bind(sub.last_sent_day || 0, sub.id).run();
        skipped++;
        continue;
      }
      const stop = await stopUrl(env, d, cal, sub.id);
      const msg = doorEmail({ calTitle: cal.title, day, calUrl: calUrl(env, cal), stopUrl: stop, address: env.MAIL_ADDRESS });
      const ok = await sendEmail(env, { to: sub.email, fromName: fromName(cal, env), stopUrl: stop, idempotencyKey: `advent-${sub.id}-${cal.year}-${day}`, ...msg });
      if (ok) sent++;
      else {
        await giveBackBudget(env, 'email-send', now);
        await env.DB.prepare('UPDATE reminder_subs SET last_sent_day = ? WHERE id = ?').bind(sub.last_sent_day || 0, sub.id).run();
      }
    }
  }
  // Unconfirmed sign-ups are forgotten after their link expires.
  await env.DB.prepare("DELETE FROM reminder_subs WHERE status = 'pending' AND created_at < ?").bind(now - (CONFIRM_DAYS + 1) * 86400000).run();
  if (sent || skipped) console.log('advent reminders', { sent, skipped });
  await capAlert(env, now);
  return { sent, skipped };
}

// Tells the owner once when sign-ups near the cap and once when it's full (ALERT_EMAIL setting).
async function capAlert(env, now) {
  if (!env.ALERT_EMAIL) return;
  const n = await confirmedCount(env);
  const level = capAlertLevel(n);
  if (!level) return;
  // day = 'once' marks the alert as sent for good. Claim first so two runs can't both send.
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO rate_limits (k, day, n) VALUES (?, 'once', 1)").bind(`cap-alert-${level}`).run();
  if (!(claim.meta && claim.meta.changes)) return;
  const ok = await sendEmail(env, { to: env.ALERT_EMAIL, fromName: 'Advent calendars', ...capAlertEmail(level, n, adminUrl(env)) });
  if (!ok) await env.DB.prepare("DELETE FROM rate_limits WHERE k = ? AND day = 'once'").bind(`cap-alert-${level}`).run();
}

async function signupAlert(env, now, cal, email, t) {
  if (!env.ALERT_EMAIL) return;
  try {
    if (!(await takeBudget(env, 'email-signup-alert', SIGNUP_ALERT_DAILY_CAP, now))) return;
    const msg = newSignupEmail({ calTitle: cal.title, email, launch: !!t.l, daily: !!t.d, newsletter: !!t.n, confirmed: await confirmedCount(env), adminUrl: adminUrl(env) });
    const ok = await sendEmail(env, { to: env.ALERT_EMAIL, fromName: 'Advent calendars', ...msg });
    if (!ok) await giveBackBudget(env, 'email-signup-alert', now);
  } catch (e) {
    console.error('signup alert failed', e && e.message);
  }
}

// /admin: remove one person (a fake sign-up, or someone asking to be deleted).
export async function handleSignupRemove(env, slug, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { error: 'Which email?', status: 400 };
  const r = await env.DB.prepare('DELETE FROM reminder_subs WHERE calendar_slug = ? AND email = ?').bind(slug, e).run();
  return { removed: (r.meta && r.meta.changes) || 0 };
}

// Cloudflare Turnstile: one server-side check per sign-up, before any email is sent.
async function turnstileOk(env, token, ip) {
  if (!token || typeof token !== 'string' || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip && ip !== 'unknown') form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const out = await r.json();
    return !!out.success && (!out.hostname || out.hostname === new URL(env.APP_URL).hostname);
  } catch (e) {
    console.error('turnstile check failed', e && e.message);
    return false;
  }
}
