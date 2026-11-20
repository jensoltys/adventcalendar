// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// Email reminders for the calendars: a "the calendar is open" email on Dec 1, an
// optional "today's door is open" email each morning, and an optional opt-in to your
// newsletter (NEWSLETTER_NAME setting), which you upload to your newsletter tool yourself.
// Nothing is sent until the address is confirmed (double opt-in).
//
// Pure logic only: no network, no D1, no env. Covered by test/remind.test.mjs.

// Resend's free plan allows 100 emails a day. Advent mail uses at most this many,
// which leaves room for anything else you send from the same Resend account.
export const EMAIL_DAILY_CAP = 60;
// At most this many people signed up across all calendars (each gets at most one
// scheduled email a day), which keeps the scheduled sends under the cap.
export const SUB_CAP = 50;
// Confirm emails get their own smaller share, so a burst of sign-ups (real or fake)
// can never use up what the door emails need: SUB_CAP + this = EMAIL_DAILY_CAP.
// Never below 10: if SUB_CAP is raised without EMAIL_DAILY_CAP, a 0 or negative
// share would turn every new sign-up away with "busy" and send no confirm email.
export function confirmCap(dailyCap, subCap) { return Math.max(10, dailyCap - subCap); }
export const CONFIRM_DAILY_CAP = confirmCap(EMAIL_DAILY_CAP, SUB_CAP);
// Local hour the morning email goes out.
export const SEND_HOUR = 7;
// A confirm link works for a week, and the same address gets at most one every 10 minutes.
export const CONFIRM_DAYS = 7;
export const CONFIRM_RESEND_MS = 10 * 60 * 1000;

const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  // A leading = + - @ could run as a formula when the newsletter CSV opens in a spreadsheet.
  return e.length <= 254 && EMAIL_RE.test(e) && !/^[=+\-@]/.test(e) ? e : '';
}

export function validTz(tz) {
  if (typeof tz !== 'string' || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Year, month (1-12), day and hour on the wall clock in `tz`. */
export function localParts(tz, nowMs) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' });
  const p = {};
  for (const x of f.formatToParts(new Date(nowMs))) p[x.type] = Number(x.value);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour };
}

/**
 * Which door's email is due for this subscriber right now, or 0 for none.
 * Door 1's email is the "it's open" email, sent to anyone who asked for either
 * kind. Doors 2 to 24 go only to daily subscribers. A missed morning is never
 * sent late on a later day: only today's door is ever due.
 */
export function dueDay(sub, calYear, nowMs) {
  if (!sub || sub.status !== 'confirmed') return 0;
  const tz = validTz(sub.tz) ? sub.tz : 'America/Chicago';
  const t = localParts(tz, nowMs);
  if (t.year !== calYear || t.month !== 12 || t.day < 1 || t.day > 24 || t.hour < SEND_HOUR) return 0;
  if ((sub.last_sent_day || 0) >= t.day) return 0;
  if (t.day === 1) return sub.want_launch || sub.want_daily ? 1 : 0;
  return sub.want_daily ? t.day : 0;
}

/** Sign-ups close once Dec 24 is over everywhere. */
export function signupsOpen(calYear, nowMs) {
  return nowMs < Date.UTC(calYear, 11, 25, 12);
}

/** Every reminder row is deleted after this, newsletter list included (privacy policy). */
export function purgeAfter(calYear) {
  return Date.UTC(calYear + 1, 1, 1);
}

// ---------------------------------------------------------------------------
// Email copy. Plain words, no em dashes, no semicolons.

// Marketing email law (CAN-SPAM in the US) wants a postal address in every email.
// Set MAIL_ADDRESS in wrangler.toml. This placeholder shows until you do.
const ADDRESS_PLACEHOLDER = 'YOUR BUSINESS NAME, YOUR BUSINESS ADDRESS';
function addressOf(a) { return String(a || '').trim() || ADDRESS_PLACEHOLDER; }
export function newsletterName(name) { return name ? `the ${name} newsletter` : 'the newsletter'; }

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function shell({ title, lines, button, url, footer }) {
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f1ea;font-family:Helvetica,Arial,sans-serif;color:#2b2420">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
<h1 style="font-size:22px;line-height:1.25;margin:0 0 14px">${esc(title)}</h1>
${lines.map((l) => `<p style="font-size:16px;line-height:1.5;margin:0 0 12px">${esc(l)}</p>`).join('\n')}
<p style="margin:22px 0"><a href="${esc(url)}" style="display:inline-block;background:#8a3b2e;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">${esc(button)}</a></p>
<p style="font-size:13px;line-height:1.5;color:#6b625b;margin:18px 0 0">${footer}</p>
</div></body></html>`;
  return html;
}

export function confirmEmail({ calTitle, newsletterTitle, address, launch, daily, newsletter, confirmUrl }) {
  const ADDRESS = addressOf(address);
  const picked = [];
  if (launch) picked.push('An email when the calendar opens on December 1');
  if (daily) picked.push('An email each morning when a new door opens, until December 24');
  if (newsletter) picked.push(`Also ${newsletterName(newsletterTitle)}`);
  const lines = [
    `You asked for reminders from ${calTitle}. Tap the button to say yes. Nothing else gets sent until you do.`,
    'You picked:',
    ...picked.map((p) => `• ${p}`),
  ];
  const footer = `Didn't ask for this? Ignore this email and you won't hear from us. The link works for ${CONFIRM_DAYS} days.<br>${esc(ADDRESS)}`;
  return {
    subject: `Confirm your reminders for ${calTitle}`,
    html: shell({ title: 'One tap to confirm', lines, button: 'Yes, send my reminders', url: confirmUrl, footer }),
    text: `${lines.join('\n')}\n\nYes, send my reminders: ${confirmUrl}\n\nDidn't ask for this? Ignore this email and you won't hear from us.\n${ADDRESS}`,
  };
}

export function doorEmail({ calTitle, day, calUrl, stopUrl, address }) {
  const ADDRESS = addressOf(address);
  const subject = day === 1 ? `It's open: door 1 of ${calTitle}` : day === 24 ? `The last door is open: ${calTitle}` : `Door ${day} is open: ${calTitle}`;
  const title = day === 1 ? 'The calendar is open' : day === 24 ? 'Door 24 is open' : `Door ${day} is open`;
  const lines = day === 1
    ? ['Door 1 is waiting for you, and a new door opens every day until December 24.']
    : day === 24
      ? ["It's the last one. Thanks for opening the doors with me this month."]
      : [`Door ${day} of ${calTitle} opened this morning.`];
  const footer = `You're getting this because you signed up for reminders on ${esc(calTitle)}. <a href="${esc(stopUrl)}" style="color:#6b625b">Stop these emails</a>.<br>${esc(ADDRESS)}`;
  return {
    subject,
    html: shell({ title, lines, button: `Open door ${day}`, url: calUrl, footer }),
    text: `${lines.join('\n')}\n\nOpen door ${day}: ${calUrl}\n\nStop these emails: ${stopUrl}\n${ADDRESS}`,
  };
}

// One email to the owner when sign-ups near the cap and one when it's full.
export const CAP_WARN_AT = 40;
export function capAlertLevel(confirmed) {
  if (confirmed >= SUB_CAP) return 'full';
  if (confirmed >= CAP_WARN_AT) return 'near';
  return '';
}
export function capAlertEmail(level, confirmed, adminUrl) {
  const full = level === 'full';
  const lines = full
    ? [`All ${SUB_CAP} reminder spots are taken across your advent calendars.`,
       'New visitors now see "reminders are full" and get buttons to add a reminder to their own phone calendar instead. The calendars still work for everyone.',
       'If you want more people on the email list, move to a bigger Resend plan and raise SUB_CAP and EMAIL_DAILY_CAP in src/lib/remind.js.']
    : [`${confirmed} of ${SUB_CAP} reminder spots are taken across your advent calendars.`,
       `When it hits ${SUB_CAP}, new visitors can't sign up for emails. If you want room for more, move to a bigger Resend plan and raise SUB_CAP and EMAIL_DAILY_CAP in src/lib/remind.js.`];
  return {
    subject: full ? 'Advent reminders are full' : `Advent reminders: ${confirmed} of ${SUB_CAP} spots taken`,
    html: shell({ title: full ? 'Reminder spots are full' : 'Reminder spots are filling up', lines, button: 'See who signed up', url: adminUrl, footer: 'Sent once by your advent calendar.' }),
    text: `${lines.join('\n\n')}\n\nSee who signed up: ${adminUrl}`,
  };
}

// One email to the owner (ALERT_EMAIL) each time someone confirms, on top of the 40/50 cap alerts.
export const SIGNUP_ALERT_DAILY_CAP = 20;
export function newSignupEmail({ calTitle, email, launch, daily, newsletter, confirmed, adminUrl }) {
  const picked = [];
  if (daily) picked.push('a daily door email');
  else if (launch) picked.push('the December 1 "it\'s open" email');
  if (newsletter) picked.push('your newsletter');
  const lines = [
    `${email} just confirmed reminders for ${calTitle}.`,
    `They picked ${picked.length ? picked.join(' and ') : 'no emails'}.`,
    `That's ${confirmed} of ${SUB_CAP} reminder spots taken across all your advent calendars.`,
  ];
  return {
    subject: `New advent sign-up: ${calTitle}`,
    html: shell({ title: 'Someone signed up', lines, button: 'See who signed up', url: adminUrl, footer: 'Sent by your advent calendar each time someone confirms.' }),
    text: `${lines.join('\n\n')}\n\nSee who signed up: ${adminUrl}`,
  };
}

// IPv6 visitors get a whole /64 from their provider, so limits count the /64, not the address.
export function ipBucket(ip) {
  const s = String(ip || '');
  if (!s.includes(':')) return s;
  const parts = s.split('::')[0].split(':');
  const full = s.includes('::') ? parts.concat(Array(8).fill('0')).slice(0, 8) : s.split(':');
  return full.slice(0, 4).join(':') + '::/64';
}
