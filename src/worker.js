// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// Advent Calendar: Cloudflare Worker for the public calendars, the door date-lock,
// the admin API (used by the /admin editor page) and the reminder .ics + emails.

import { frameAncestorsFrom, homeHostsFrom, DOOR_TYPES, PLAYS, THEMES, unlockedOnServer, cleanHomeUrl } from './lib/rules.js';
import { remindersIcs } from './lib/ics.js';
import { handleSignup, handleConfirm, handleStop, handleSignupsAdmin, handleSignupsExported, handleSignupRemove, runReminders } from './reminders.js';

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
function csp(frameAncestors) {
  return [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // Cloudflare Web Analytics (cookieless) works if you turn it on for your zone.
    // Cloudflare Turnstile guards the reminder sign-up box.
    "script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com",
    "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

// Calendar pages are embeddable on the EMBED_ORIGINS sites only. Everything else is never framed.
// Set once per request from env (it's the same for every request on one deploy).
let FRAME_ANCESTORS = "'self'";
function secHeaders({ embeddable = false, noindex = false } = {}) {
  const h = {
    'Content-Security-Policy': csp(embeddable ? FRAME_ANCESTORS : "'none'"),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    'Strict-Transport-Security': 'max-age=15552000',
  };
  if (!embeddable) h['X-Frame-Options'] = 'DENY';
  if (noindex) h['X-Robots-Tag'] = 'noindex, nofollow';
  return h;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...secHeaders({ noindex: true }), ...extra },
  });
}
function err(message, status = 400) { return json({ error: message }, status); }

const MAX_BODY = 64 * 1024;
async function bodyOr(request) {
  const len = request.headers.get('Content-Length');
  if (len && Number(len) > MAX_BODY) return { resp: err('Request too large', 413) };
  const text = await request.text();
  if (text.length > MAX_BODY) return { resp: err('Request too large', 413) };
  if (!text) return { body: {} };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { resp: err('Bad JSON', 400) };
    return { body };
  } catch {
    return { resp: err('Bad JSON', 400) };
  }
}

// Per-isolate best-effort rate limiter.
const rateBuckets = new Map();
function rateLimit(key, limit, windowMs, now) {
  const b = rateBuckets.get(key);
  if (!b || now >= b.resetAt) { rateBuckets.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}
function clientIp(request) { return request.headers.get('CF-Connecting-IP') || 'unknown'; }

// ---------------------------------------------------------------------------
// Admin auth. The /admin editor page sends the ADMIN_API_TOKEN secret as a Bearer
// header (you paste it in once per browser tab). No cookie, so nothing for another
// site to forge. With no token set, or one under 32 characters, admin stays locked.
// ---------------------------------------------------------------------------
function timingSafeEqualStr(a, b) {
  const A = new TextEncoder().encode(String(a)); const B = new TextEncoder().encode(String(b));
  if (A.length !== B.length) return false;
  let r = 0; for (let i = 0; i < A.length; i++) r |= A[i] ^ B[i];
  return r === 0;
}
function isAdminCall(request, env) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S{20,200})$/i);
  return !!(m && typeof env.ADMIN_API_TOKEN === 'string' && env.ADMIN_API_TOKEN.length >= 32 && timingSafeEqualStr(m[1], env.ADMIN_API_TOKEN));
}

// Preview links: a short-lived signed token that shows every door of one calendar.
function b64urlFromBytes(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function bytesFromB64url(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
// Refuse to sign or check links without a real secret. A missing one would turn into
// the word 'undefined', and anyone could forge a preview or unsubscribe link.
function requireSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('JWT_SECRET must be set to a random string of 32+ characters.');
  return secret;
}
async function hmacKey(secret) { return crypto.subtle.importKey('raw', new TextEncoder().encode(requireSecret(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function signToken(payload, secret) {
  const body = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${b64urlFromBytes(new Uint8Array(sig))}`;
}
async function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !secret) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), bytesFromB64url(parts[1]), new TextEncoder().encode(parts[0])); } catch { return null; }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(parts[0])));
    return payload && typeof payload.exp === 'number' && payload.exp >= Math.floor(Date.now() / 1000) ? payload : null;
  } catch { return null; }
}
const PREVIEW_HOURS = 12;
// The token names the calendar AND its created_at, so a link made for a deleted
// calendar can't open a new one that reuses the same slug.
async function previewUrl(env, cal) {
  const slug = cal.slug;
  const token = await signToken({ pv: slug, c: cal.created_at || 0, exp: Math.floor(Date.now() / 1000) + PREVIEW_HOURS * 3600 }, env.JWT_SECRET);
  return `${env.APP_URL}/c/${slug}?preview=${token}`;
}

// ---------------------------------------------------------------------------
// Calendars + doors
// ---------------------------------------------------------------------------
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const DOOR_FIELDS = ['type', 'title', 'blurb', 'cta_label', 'cta_url', 'code', 'code_note', 'review_url', 'image_url', 'image_alt', 'sponsor', 'play', 'play_items'];
const FIELD_MAX = { type: 20, title: 120, blurb: 600, cta_label: 40, cta_url: 500, code: 40, code_note: 160, review_url: 500, image_url: 500, image_alt: 200, sponsor: 80, play: 20, play_items: 2000 };
const URL_FIELDS = new Set(['cta_url', 'review_url', 'image_url']);
const DOOR_COLS = 'day, type, title, blurb, cta_label, cta_url, code, code_note, review_url, image_url, image_alt, sponsor, play, play_items, updated_at';

async function loadCalendar(env, slug) {
  if (!SLUG_RE.test(slug)) return null;
  return env.DB.prepare('SELECT slug, title, subtitle, theme, year, demo, published, home_url, updated_at, created_at FROM calendars WHERE slug = ?').bind(slug).first();
}
async function loadDoors(env, slug) {
  const r = await env.DB.prepare(`SELECT ${DOOR_COLS} FROM doors WHERE calendar_slug = ? ORDER BY day`).bind(slug).all();
  return r.results || [];
}
function publicCalendar(c) {
  return { slug: c.slug, title: c.title, subtitle: c.subtitle, theme: c.theme, year: c.year, demo: !!c.demo, published: !!c.published, home_url: c.home_url || '' };
}
function doorContent(d) {
  const out = { day: d.day };
  for (const f of DOOR_FIELDS) out[f] = d[f] || '';
  return out;
}

// Public read. A locked door goes out as { day, open: false } and nothing else,
// so its contents can't be read early from the network tab.
function emailReady(env) { return !!(env.RESEND_API_KEY && env.EMAIL_FROM && env.MAIL_ADDRESS); }
async function handlePublicCalendar(request, env, slug, now) {
  const cal = await loadCalendar(env, slug);
  const pv = await verifyToken(new URL(request.url).searchParams.get('preview'), env.JWT_SECRET);
  const preview = !!pv && !!cal && pv.pv === slug && pv.c === (cal.created_at || 0);
  if (!cal || (!cal.published && !preview)) return err('Not found', 404);
  const doors = (await loadDoors(env, slug)).map((d) => {
    const open = !!cal.demo || preview || unlockedOnServer(cal.year, d.day, now);
    return open ? { ...doorContent(d), open: true } : { day: d.day, open: false };
  });
  // no-store: a change in /admin (a door, the look) shows on the next load.
  // The bot check only switches on once both its keys are set.
  const turnstile = env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET ? env.TURNSTILE_SITEKEY : '';
  // The "Don't miss a door" box only shows when email can actually be sent.
  const email = emailReady(env);
  // Page settings from wrangler.toml, so the page itself has nothing to edit.
  const site = { own: listSetting(env.OWN_HOSTS), blogs: listSetting(env.AFFILIATE_ORIGINS), newsletter: String(env.NEWSLETTER_NAME || '').slice(0, 60) };
  return json({ calendar: publicCalendar(cal), doors, preview, server_now: now, turnstile, email, site });
}
function listSetting(v) {
  return String(v || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 50);
}

function cleanDoorField(field, value) {
  let v = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (field !== 'blurb' && field !== 'play_items') v = v.replace(/\s+/g, ' ');
  v = v.slice(0, FIELD_MAX[field]);
  if (field === 'type' && v && !DOOR_TYPES.includes(v)) return { error: 'Pick a door type from the list.' };
  if (field === 'play' && v && !PLAYS.includes(v)) return { error: 'Pick a game from the list.' };
  // A file hosted on this site can be written as a path, like /doors/sock-wallpaper.png
  if (field === 'cta_url' && /^\/doors\/[A-Za-z0-9._\/-]{1,200}$/.test(v) && !v.includes('..')) return { value: v };
  if (URL_FIELDS.has(field) && v) {
    let u; try { u = new URL(v); } catch { return { error: `That link doesn't look right: ${v.slice(0, 60)}` }; }
    if (u.protocol !== 'https:') return { error: 'Links have to start with https://' };
    v = u.toString();
  }
  return { value: v };
}

async function handlePutDoor(request, env, slug, day, now) {
  const cal = await loadCalendar(env, slug);
  if (!cal || !Number.isInteger(day) || day < 1 || day > 24) return err('Not found', 404);
  const { body, resp } = await bodyOr(request); if (resp) return resp;
  const sets = []; const binds = [];
  for (const f of DOOR_FIELDS) {
    if (!(f in body)) continue;
    const r = cleanDoorField(f, body[f]);
    if (r.error) return err(r.error, 400);
    sets.push(`${f} = ?`); binds.push(r.value);
  }
  if (!sets.length) return err('Nothing to save', 400);
  sets.push('updated_at = ?'); binds.push(now);
  await env.DB.prepare(`INSERT OR IGNORE INTO doors (calendar_slug, day) VALUES (?, ?)`).bind(slug, day).run();
  await env.DB.prepare(`UPDATE doors SET ${sets.join(', ')} WHERE calendar_slug = ? AND day = ?`).bind(...binds, slug, day).run(); // sec-ok(5): column names come only from the DOOR_FIELDS allowlist, every value is bound
  const row = await env.DB.prepare(`SELECT ${DOOR_COLS} FROM doors WHERE calendar_slug = ? AND day = ?`).bind(slug, day).first();
  return json({ door: { ...doorContent(row), updated_at: row.updated_at } });
}

async function handlePutCalendar(request, env, slug, now) {
  const cal = await loadCalendar(env, slug);
  if (!cal) return err('Not found', 404);
  const { body, resp } = await bodyOr(request); if (resp) return resp;
  const sets = []; const binds = [];
  if ('title' in body) { const t = String(body.title || '').trim().replace(/\s+/g, ' ').slice(0, 100); if (!t) return err('The calendar needs a title.', 400); sets.push('title = ?'); binds.push(t); }
  if ('subtitle' in body) { sets.push('subtitle = ?'); binds.push(String(body.subtitle || '').trim().replace(/\s+/g, ' ').slice(0, 200)); }
  if ('home_url' in body) { const h = cleanHomeUrl(body.home_url, homeHostsFrom(env.HOME_HOSTS)); if (h === null) return err('The post link has to be a https page on one of the sites in your HOME_HOSTS setting.', 400); sets.push('home_url = ?'); binds.push(h); }
  if ('published' in body) { sets.push('published = ?'); binds.push(body.published ? 1 : 0); }
  if ('theme' in body) { if (!Object.hasOwn(THEMES, body.theme)) return err('Pick a look from the list.', 400); sets.push('theme = ?'); binds.push(body.theme); }
  if (!sets.length) return err('Nothing to save', 400);
  sets.push('updated_at = ?'); binds.push(now);
  await env.DB.prepare(`UPDATE calendars SET ${sets.join(', ')} WHERE slug = ?`).bind(...binds, slug).run(); // sec-ok(5): column names are fixed strings in this function, every value is bound
  return json({ calendar: publicCalendar(await loadCalendar(env, slug)) });
}

// A new calendar starts hidden, with 24 empty doors. The slug comes from the title.
function slugify(title) {
  return String(title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'calendar';
}
async function handleCreateCalendar(request, env, now) {
  const { body, resp } = await bodyOr(request); if (resp) return resp;
  const title = String(body.title || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!title) return err('Give the calendar a name.', 400);
  if (!Object.hasOwn(THEMES, body.theme)) return err('Pick a look from the list.', 400);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM calendars').first();
  if (count && count.n >= 30) return err("That's a lot of calendars. Remove one before adding another.", 400);
  const base = slugify(title); let slug = base;
  for (let i = 2; await loadCalendar(env, slug); i++) slug = `${base}-${i}`.slice(0, 40);
  const subtitle = String(body.subtitle || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const year = new Date(now).getUTCMonth() === 11 && new Date(now).getUTCDate() > 24 ? new Date(now).getUTCFullYear() + 1 : new Date(now).getUTCFullYear();
  const stmts = [env.DB.prepare('INSERT INTO calendars (slug, title, subtitle, theme, year, demo, published, updated_at, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)').bind(slug, title, subtitle, body.theme, year, now, now)];
  for (let d = 1; d <= 24; d++) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO doors (calendar_slug, day) VALUES (?, ?)').bind(slug, d));
  await env.DB.batch(stmts);
  return json({ calendar: publicCalendar(await loadCalendar(env, slug)) }, 201);
}

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------
async function serveAsset(env, url, assetPath, opts) {
  const r = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin), { headers: { Accept: 'text/html' } }));
  const out = new Response(r.body, r);
  for (const [k, v] of Object.entries(secHeaders(opts))) out.headers.set(k, v);
  return out;
}
async function serveCalendar(env, url, slug, door) {
  const shell = await serveAsset(env, url, '/calendar', { embeddable: true });
  const cal = await loadCalendar(env, slug);
  if (!cal || !cal.published) return shell;
  const theme = Object.hasOwn(THEMES, cal.theme) ? cal.theme : 'workshop';
  const page = `${env.APP_URL}/c/${cal.slug}${door === 'all' ? '/done' : door ? `/door/${door}` : ''}`;
  const title = door === 'all' ? `I opened all 24 doors of ${cal.title}` : door ? `I opened door ${door} of ${cal.title}` : cal.title;
  const desc = door ? 'A free surprise behind every door until December 24. Come open yours.' : (cal.subtitle || 'One door opens each day from December 1 to 24.');
  const img = door ? `${env.APP_URL}/share/${theme}/${door}.jpg` : `${env.APP_URL}/og.png`;
  const alt = door === 'all' ? 'A stuffed stocking peeking out of an open advent door, with the words I opened all 24 doors' : door ? `An open advent calendar door number ${door} with a stocking peeking out, and the words I opened door ${door}` : 'A grid of wrapped advent calendar doors numbered 1 to 24 with door 24 wrapped in gold';
  const set = (v) => ({ element(e) { e.setAttribute('content', v); } });
  return new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(title); } })
    .on('meta[name="description"]', set(desc))
    .on('meta[property="og:title"]', set(title))
    .on('meta[property="og:description"]', set(desc))
    .on('meta[property="og:image"]', set(img))
    .on('meta[property="og:image:alt"]', set(alt))
    .on('meta[name="twitter:image"]', set(img))
    .on('head', { element(e) { e.append(`<meta property="og:url" content="${page}"><link rel="canonical" href="${env.APP_URL}/c/${cal.slug}">`, { html: true }); } })
    .transform(shell);
}

async function notFound(env, url) {
  const r = await env.ASSETS.fetch(new Request(new URL('/__not_found__', url.origin), { headers: { Accept: 'text/html' } }));
  const out = new Response(r.body, { status: 404, headers: r.headers });
  for (const [k, v] of Object.entries(secHeaders())) out.headers.set(k, v);
  return out;
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// What the reminder routes need from this file.
const deps = { json, err, bodyOr, rateLimit, clientIp, loadCalendar, signToken, verifyToken, secHeaders, emailReady, esc: escHtml };

async function handle(request, env) {
  if (typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.length < 32) {
    return new Response('This calendar needs its JWT_SECRET set (a random string of 32+ characters). See README.md.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...secHeaders({ noindex: true }) } });
  }
  const url = new URL(request.url);
  const path = url.pathname;
  const now = Date.now();
  FRAME_ANCESTORS = frameAncestorsFrom(env.EMBED_ORIGINS);

  if (path.startsWith('/api/')) {
    let m = path.match(/^\/api\/c\/([a-z0-9-]{1,40})$/);
    if (m && request.method === 'GET') return handlePublicCalendar(request, env, m[1], now);
    m = path.match(/^\/api\/c\/([a-z0-9-]{1,40})\/remind$/);
    if (m && request.method === 'POST') return handleSignup(request, env, m[1], now, deps);

    if (path.startsWith('/api/admin/')) {
      if (!rateLimit(`admin:${clientIp(request)}`, 240, 60 * 1000, now)) return err('Slow down a little and try again.', 429);
      if (!isAdminCall(request, env)) return err('Unauthorized', 401);
      if (path === '/api/admin/calendars' && request.method === 'GET') {
        const r = await env.DB.prepare('SELECT slug, title, subtitle, theme, year, demo, published, home_url, updated_at FROM calendars ORDER BY demo, slug').all();
        return json({ calendars: (r.results || []).map(publicCalendar), themes: THEMES });
      }
      if (path === '/api/admin/calendars' && request.method === 'POST') return handleCreateCalendar(request, env, now);
      m = path.match(/^\/api\/admin\/c\/([a-z0-9-]{1,40})\/preview$/);
      if (m && request.method === 'POST') {
        const cal = await loadCalendar(env, m[1]);
        if (!cal) return err('Not found', 404);
        return json({ url: await previewUrl(env, cal), hours: PREVIEW_HOURS });
      }
      m = path.match(/^\/api\/admin\/c\/([a-z0-9-]{1,40})$/);
      if (m && request.method === 'GET') {
        const cal = await loadCalendar(env, m[1]);
        if (!cal) return err('Not found', 404);
        return json({ calendar: publicCalendar(cal), doors: (await loadDoors(env, m[1])).map((d) => ({ ...doorContent(d), updated_at: d.updated_at })) });
      }
      if (m && request.method === 'PUT') return handlePutCalendar(request, env, m[1], now);
      if (m && request.method === 'DELETE') {
        const cal = await loadCalendar(env, m[1]);
        if (!cal) return err('Not found', 404);
        // The demo shows visitors how a calendar works, so the editor can't delete it.
        if (cal.demo) return err("The demo can't be deleted from here.", 400);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM doors WHERE calendar_slug = ?').bind(cal.slug),
          env.DB.prepare('DELETE FROM reminder_subs WHERE calendar_slug = ?').bind(cal.slug),
          env.DB.prepare('DELETE FROM calendars WHERE slug = ?').bind(cal.slug),
        ]);
        return json({ deleted: cal.slug });
      }
      m = path.match(/^\/api\/admin\/c\/([a-z0-9-]{1,40})\/signups$/);
      if (m && request.method === 'GET') {
        const cal = await loadCalendar(env, m[1]);
        if (!cal) return err('Not found', 404);
        return json(await handleSignupsAdmin(env, cal.slug));
      }
      m = path.match(/^\/api\/admin\/c\/([a-z0-9-]{1,40})\/signups\/remove$/);
      if (m && request.method === 'POST') {
        const cal = await loadCalendar(env, m[1]);
        if (!cal) return err('Not found', 404);
        const { body, resp } = await bodyOr(request); if (resp) return resp;
        const out = await handleSignupRemove(env, cal.slug, body.email);
        return out.error ? err(out.error, out.status) : json(out);
      }
      m = path.match(/^\/api\/admin\/c\/([a-z0-9-]{1,40})\/signups\/exported$/);
      if (m && request.method === 'POST') {
        const cal = await loadCalendar(env, m[1]);
        if (!cal) return err('Not found', 404);
        const out = await handleSignupsExported(request, env, cal.slug, now);
        return out.error ? err(out.error, out.status) : json(out);
      }
      m = path.match(/^\/api\/admin\/c\/([a-z0-9-]{1,40})\/doors\/(\d{1,2})$/);
      if (m && request.method === 'PUT') return handlePutDoor(request, env, m[1], Number(m[2]), now);
    }
    return err('Not found', 404);
  }

  // Calendar page: one shell for every calendar, so an embed and the standalone page
  // are the same file. Unknown or unpublished slugs still get the shell; it shows
  // its own "not here" state from the API.
  // Calendar page, plus share links: /c/<slug>/door/<n> and /c/<slug>/done get a link
  // preview with that door's "I opened door N" picture. Same shell, so the friend who
  // taps the link lands on the calendar itself.
  let m = path.match(/^\/c\/([a-z0-9-]{1,40})(?:\/(?:door\/([1-9]|1\d|2[0-4])|(done)))?\/?$/);
  if (m) return serveCalendar(env, url, m[1], m[2] ? Number(m[2]) : m[3] ? 'all' : null);
  m = path.match(/^\/c\/([a-z0-9-]{1,40})\/reminders\.ics$/);
  if (m) {
    const cal = await loadCalendar(env, m[1]);
    if (!cal || !cal.published) return notFound(env, url);
    return new Response(remindersIcs(cal, `${url.origin}/c/${cal.slug}`), {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${cal.slug}-reminders.ics"`, 'Cache-Control': 'public, max-age=3600', ...secHeaders() },
    });
  }
  if (path === '/calendar' || path === '/calendar.html') return notFound(env, url);
  m = path.match(/^\/r\/(yes|stop)\/([A-Za-z0-9_-]{10,1200}\.[A-Za-z0-9_-]{43})$/);
  if (m && (request.method === 'GET' || request.method === 'POST')) {
    if (request.method === 'POST' && !rateLimit(`r:${clientIp(request)}`, 30, 60 * 1000, now)) return err('Slow down a little and try again.', 429);
    return m[1] === 'yes' ? handleConfirm(request, env, m[2], now, deps) : handleStop(request, env, m[2], now, deps);
  }

  // Door downloads. An HTML file downloads instead of opening, so it can be saved and used offline.
  if (path.startsWith('/doors/')) {
    if (path.includes('/.') || path.includes('..')) return notFound(env, url);
    const name = path.split('/').pop();
    // Every door file has an extension. A bare path would make the asset store serve
    // an HTML door as a page on this domain instead of a download.
    if (!/\.(pdf|png|jpg|html)$/.test(name)) return notFound(env, url);
    const isHtml = /\.html$/.test(name);
    // The asset store redirects /x.html to /x, so an HTML door is fetched by its bare path.
    const r = await env.ASSETS.fetch(isHtml ? new Request(new URL(path.slice(0, -5), url.origin)) : request);
    if (r.status !== 200) return notFound(env, url);
    const out = new Response(r.body, r);
    for (const [k, v] of Object.entries(secHeaders())) out.headers.set(k, v);
    // Saved under a clean name: the random tail only exists to keep the link unguessable.
    out.headers.set('Content-Disposition', `${isHtml ? 'attachment' : 'inline'}; filename="${name.replace(/-[0-9a-f]{8}(?=\.\w+$)/, '')}"`);
    out.headers.set('Cache-Control', 'public, max-age=3600');
    return out;
  }

  if (path === '/.well-known/security.txt') {
    if (!env.SECURITY_CONTACT) return notFound(env, url);
    return new Response(`Contact: mailto:${env.SECURITY_CONTACT}\nExpires: 2027-12-31T23:59:59Z\nPreferred-Languages: en\nCanonical: ${env.APP_URL}/.well-known/security.txt\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...secHeaders() } });
  }
  // Dotfiles and config-looking names never reach the asset store.
  if (path.includes('/.') || /\.(env|toml|sql|md|lock)$/.test(path)) return notFound(env, url);
  const assetResp = await env.ASSETS.fetch(request);
  const out = new Response(assetResp.body, assetResp);
  const admin = path === '/admin' || path.startsWith('/admin/');
  for (const [k, v] of Object.entries(secHeaders({ noindex: admin }))) out.headers.set(k, v);
  if (admin) out.headers.set('Cache-Control', 'no-store');
  // Link previews need full addresses, so the home page gets them from APP_URL.
  if (path === '/' && assetResp.status === 200) {
    const full = (v) => ({ element(e) { e.setAttribute('content', v); } });
    const home = `${escHtml(env.APP_URL)}/`;
    return new HTMLRewriter()
      .on('meta[property="og:image"]', full(`${env.APP_URL}/og.png`))
      .on('meta[name="twitter:image"]', full(`${env.APP_URL}/og.png`))
      .on('head', { element(e) { e.append(`<meta property="og:url" content="${home}"><link rel="canonical" href="${home}">`, { html: true }); } })
      .transform(out);
  }
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, Date.now(), deps).catch((e) => console.error('reminder run failed', (e && e.stack) || e)));
  },
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error('unhandled route error', request.method, new URL(request.url).pathname, (e && e.stack) || e);
      return new Response(JSON.stringify({ error: 'Something went wrong on our end. Try again in a minute.' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...secHeaders() } });
    }
  },
};
