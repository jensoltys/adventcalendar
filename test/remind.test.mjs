// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dueDay, cleanEmail, validTz, signupsOpen, confirmEmail, doorEmail, capAlertLevel, capAlertEmail, confirmCap, CONFIRM_DAILY_CAP, EMAIL_DAILY_CAP, SUB_CAP } from '../src/lib/remind.js';

const sub = (o) => ({ status: 'confirmed', tz: 'America/Chicago', want_launch: 1, want_daily: 0, last_sent_day: 0, ...o });
// 7:00 Dec N in Chicago (UTC-6) is 13:00 UTC.
const chi = (day, hour) => Date.UTC(2026, 11, day, hour + 6);

test('nothing before 7am local or outside Dec 1-24', () => {
  assert.equal(dueDay(sub(), 2026, chi(1, 6)), 0);
  assert.equal(dueDay(sub(), 2026, chi(1, 7)), 1);
  assert.equal(dueDay(sub({ want_daily: 1, last_sent_day: 24 }), 2026, chi(25, 8)), 0);
  assert.equal(dueDay(sub(), 2026, Date.UTC(2026, 10, 30, 20)), 0);
});

test('launch-only gets door 1 and nothing after', () => {
  assert.equal(dueDay(sub({ last_sent_day: 1 }), 2026, chi(1, 9)), 0);
  assert.equal(dueDay(sub({ last_sent_day: 1 }), 2026, chi(2, 9)), 0);
});

test('daily gets each day once, never a missed day late', () => {
  const s = sub({ want_launch: 0, want_daily: 1 });
  assert.equal(dueDay(s, 2026, chi(1, 7)), 1);
  assert.equal(dueDay({ ...s, last_sent_day: 1 }, 2026, chi(5, 7)), 5);
  assert.equal(dueDay({ ...s, last_sent_day: 5 }, 2026, chi(5, 23)), 0);
  assert.equal(dueDay({ ...s, last_sent_day: 23 }, 2026, chi(24, 7)), 24);
});

test('local zone decides the day', () => {
  // 13:00 UTC Dec 2 = 7am Chicago Dec 2, but already 11pm Dec 2 in Sydney (sent that morning).
  const tokyo = sub({ tz: 'Asia/Tokyo', want_daily: 1, last_sent_day: 1 });
  assert.equal(dueDay(tokyo, 2026, Date.UTC(2026, 11, 1, 22)), 2); // 7am Dec 2 Tokyo
  assert.equal(dueDay(tokyo, 2026, Date.UTC(2026, 11, 1, 21)), 0); // 6am
});

test('unconfirmed or stopped never gets mail', () => {
  assert.equal(dueDay(sub({ status: 'pending' }), 2026, chi(1, 8)), 0);
  assert.equal(dueDay(sub({ status: 'unsubscribed' }), 2026, chi(1, 8)), 0);
});

test('email and zone checks', () => {
  assert.equal(cleanEmail(' Jen@Example.com '), 'jen@example.com');
  assert.equal(cleanEmail('nope'), '');
  assert.equal(cleanEmail('a@b'), '');
  assert.equal(cleanEmail('=cmd@x.com'), '');
  assert.equal(validTz('America/Chicago'), true);
  assert.equal(validTz('Mars/Base'), false);
  assert.equal(validTz('<script>'), false);
});

test('sign-ups close after Dec 24', () => {
  assert.equal(signupsOpen(2026, Date.UTC(2026, 11, 24, 23)), true);
  assert.equal(signupsOpen(2026, Date.UTC(2026, 11, 26)), false);
});

test('copy has an address, a stop link, and no em dashes or semicolons', () => {
  const c = confirmEmail({ calTitle: 'My Advent Calendar', newsletterTitle: 'Cozy Corner', address: 'Cozy Corner LLC, 1 Main St, Springfield', launch: 1, daily: 1, newsletter: 1, confirmUrl: 'https://x/r/yes/t' });
  const dm = doorEmail({ calTitle: 'My Advent Calendar', day: 5, calUrl: 'https://x/c/a', stopUrl: 'https://x/r/stop/t', address: 'Cozy Corner LLC, 1 Main St, Springfield' });
  for (const m of [c, dm]) {
    assert.match(m.text, /1 Main St, Springfield/);
    assert.ok(!/[—;]/.test(m.subject + m.text), m.subject);
  }
  assert.match(dm.html, /Stop these emails/);
  assert.match(c.text, /Cozy Corner newsletter/);
  assert.match(doorEmail({ calTitle: 'X', day: 2, calUrl: 'u', stopUrl: 's' }).text, /YOUR BUSINESS ADDRESS/, 'placeholder shows until MAIL_ADDRESS is set');
});

test('cap alert: nothing under 40, near at 40-49, full at 50', () => {
  assert.equal(capAlertLevel(39), '');
  assert.equal(capAlertLevel(40), 'near');
  assert.equal(capAlertLevel(49), 'near');
  assert.equal(capAlertLevel(50), 'full');
  const near = capAlertEmail('near', 42, 'https://x.test/a');
  assert.match(near.subject, /42 of 50/);
  assert.match(near.text, /https:\/\/x\.test\/a/);
  assert.match(capAlertEmail('full', 50, 'https://x.test/a').subject, /full/);
});

test('ipBucket groups IPv6 by /64', async () => {
  const { ipBucket } = await import('../src/lib/remind.js');
  assert.equal(ipBucket('203.0.113.9'), '203.0.113.9');
  assert.equal(ipBucket('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('2001:db8::1'), '2001:db8:0:0::/64');
});

test('new sign-up alert names the calendar, the picks and the count', async () => {
  const { newSignupEmail } = await import('../src/lib/remind.js');
  const m = newSignupEmail({ calTitle: 'My Advent Calendar', email: 'a@b.test', launch: true, daily: true, newsletter: false, confirmed: 2, adminUrl: 'https://x.test/a' });
  assert.match(m.subject, /My Advent Calendar/);
  assert.match(m.text, /a@b\.test/);
  assert.match(m.text, /daily door email/);
  assert.match(m.text, /2 of 50/);
  assert.match(m.text, /https:\/\/x\.test\/a/);
  assert.ok(!/[\u2014;]/.test(m.subject + m.text));
  assert.match(newSignupEmail({ calTitle: 'X', email: 'c@d.test', launch: true, daily: false, newsletter: true, confirmed: 3, adminUrl: 'u' }).text, /December 1 .* and your newsletter/);
});

test('confirm email budget never drops to 0 or below', () => {
  assert.equal(CONFIRM_DAILY_CAP, Math.max(10, EMAIL_DAILY_CAP - SUB_CAP));
  assert.equal(confirmCap(60, 50), 10);
  assert.equal(confirmCap(60, 60), 10, 'SUB_CAP raised alone still leaves room for confirms');
  assert.equal(confirmCap(60, 80), 10);
  assert.equal(confirmCap(200, 150), 50);
});
