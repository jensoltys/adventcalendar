// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// Rules shared by the Worker and the tests. Keep this file free of Worker globals.

// Door types the admin can pick. The calendar page has a label + art for each.
export const DOOR_TYPES = ['tool', 'code', 'unlock', 'deal', 'gift', 'tip', 'download', 'play', 'sponsored', 'surprise'];

// The little games a Play door can run. Each one reads its list from play_items.
export const PLAYS = ['pick', 'spin', 'scratch', 'shake', 'wallpaper'];

// Calendar looks. The CSS for each lives in public/calendar.css.
export const THEMES = {
  workshop: 'Pine',
  plum: 'Plum',
  jen8n: 'Blackberry',
  meadow: 'Meadow',
  arcade: 'Arcade',
};

// Which sites may show a calendar in an iframe: this site plus the EMBED_ORIGINS
// setting (spaces or commas between them, like "https://myblog.com https://*.myblog.com").
// Anything that isn't a plain https origin is dropped, so a typo can't loosen the policy.
export function frameAncestorsFrom(list) {
  const ok = String(list || '').split(/[\s,]+/).filter((o) => /^https:\/\/(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/i.test(o));
  return ["'self'", ...ok].join(' ');
}

// The page opens a door at midnight on the VIEWER's own date. The server can't
// know the viewer's zone, so it releases door N once Dec N has started anywhere
// on Earth (UTC+14). So someone reading the API, or with their clock set ahead,
// can see a door up to about a day before their own midnight: 14 hours early in
// London, 20 in Chicago, 24 in Hawaii. Never more than that. Don't put a code
// behind a door if it has to stay secret until the exact day.
const EARLIEST_ZONE_MS = 14 * 3600 * 1000;
export function unlockedOnServer(year, day, nowMs) {
  return nowMs >= Date.UTC(year, 11, day) - EARLIEST_ZONE_MS;
}

// The page a calendar is embedded on. Shared door links land there instead of on the
// bare calendar. '' clears it. Returns null for anything that isn't an https page on one
// of the HOME_HOSTS (a setting, commas or spaces between them), so it can't become an open redirect.
export function homeHostsFrom(list) {
  return String(list || '').split(/[\s,]+/).map((h) => h.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
}
export function cleanHomeUrl(v, hosts = []) {
  const HOME_HOSTS = hosts;
  const s = String(v || '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (u.protocol !== 'https:' || !HOME_HOSTS.includes(host) || u.username || u.password) return null;
  u.hash = '';
  return u.toString().slice(0, 300);
}
