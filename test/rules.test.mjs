// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unlockedOnServer, DOOR_TYPES } from '../src/lib/rules.js';
import { remindersIcs } from '../src/lib/ics.js';

test('door N opens once Dec N has started in UTC+14, never earlier', () => {
  const dec1Kiritimati = Date.UTC(2026, 10, 30, 10, 0, 0); // Nov 30 10:00 UTC = Dec 1 00:00 UTC+14
  assert.equal(unlockedOnServer(2026, 1, dec1Kiritimati - 1), false);
  assert.equal(unlockedOnServer(2026, 1, dec1Kiritimati), true);
  assert.equal(unlockedOnServer(2026, 2, dec1Kiritimati), false);
  assert.equal(unlockedOnServer(2026, 24, Date.UTC(2026, 11, 23, 10)), true);
  assert.equal(unlockedOnServer(2026, 24, Date.UTC(2026, 11, 23, 9, 59)), false);
  assert.equal(unlockedOnServer(2026, 24, Date.UTC(2027, 0, 5)), true);
});

test('reminder ics is a floating 9am daily event for 24 days', () => {
  const ics = remindersIcs({ slug: 'my-calendar', year: 2026, title: 'My Advent Calendar' }, 'https://example.com/c/my-calendar');
  assert.match(ics, /DTSTART:20261201T090000\r\n/);
  assert.match(ics, /RRULE:FREQ=DAILY;COUNT=24/);
  const semi = remindersIcs({ slug: 'a', year: 2026, title: 'Cats; dogs, more' }, 'https://x.example/c/a');
  assert.match(semi, /SUMMARY:Open today's door: Cats\\; dogs\\, more/, 'semicolons and commas escaped (RFC 5545 3.3.11)');
  assert.ok(!/DTSTART:[^\r]*Z/.test(ics), 'no UTC Z on start');
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, 'folded: ' + line);
});

test('door types include every option the admin offers', () => {
  for (const t of ['tool', 'code', 'unlock', 'deal', 'gift', 'tip', 'sponsored', 'surprise']) assert.ok(DOOR_TYPES.includes(t));
});

test('home_url: only https pages on the HOME_HOSTS sites', async () => {
  const { cleanHomeUrl, homeHostsFrom } = await import('../src/lib/rules.js');
  const hosts = homeHostsFrom('myblog.example, www.other.example');
  assert.deepEqual(hosts, ['myblog.example', 'other.example']);
  assert.deepEqual(homeHostsFrom('myblog.example www.other.example'), hosts, 'spaces work as well as commas');
  assert.deepEqual(homeHostsFrom(' myblog.example,\n other.example , '), hosts);
  assert.equal(cleanHomeUrl('', hosts), '');
  assert.equal(cleanHomeUrl('https://myblog.example/advent/', hosts), 'https://myblog.example/advent/');
  assert.equal(cleanHomeUrl('https://www.other.example/x/#top', hosts), 'https://www.other.example/x/');
  assert.equal(cleanHomeUrl('http://myblog.example/x/', hosts), null);
  assert.equal(cleanHomeUrl('https://myblog.example.evil.test/x/', hosts), null);
  assert.equal(cleanHomeUrl('javascript:alert(1)', hosts), null);
  assert.equal(cleanHomeUrl('https://myblog.example/x/'), null, 'no HOME_HOSTS = no home link');
});

test('embed origins: only plain https origins get into frame-ancestors', async () => {
  const { frameAncestorsFrom } = await import('../src/lib/rules.js');
  assert.equal(frameAncestorsFrom(''), "'self'");
  assert.equal(frameAncestorsFrom('https://a.example https://*.a.example'), "'self' https://a.example https://*.a.example");
  assert.equal(frameAncestorsFrom('https://a.example, https://b.example,https://c.example'), "'self' https://a.example https://b.example https://c.example", 'commas work as well as spaces');
  assert.equal(frameAncestorsFrom("* http://b.example https://c.example; script-src 'unsafe-inline'"), "'self'");
});
