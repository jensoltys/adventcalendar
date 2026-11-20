-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
-- Advent Calendar — D1 schema. Apply with:
--   npx wrangler d1 execute advent-calendar-db --remote --file=schema.sql
-- Safe to re-run: every statement is IF NOT EXISTS / INSERT OR IGNORE.

-- No admins table: the /admin editor sends the ADMIN_API_TOKEN secret.

-- demo = 1 means every door is open no matter the date.
-- published = 0 hides the calendar from the public (admin can still preview it).
CREATE TABLE IF NOT EXISTS calendars (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL,
  year INTEGER NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  -- the blog post the calendar is embedded in; shared door links land there
  home_url TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0,
  -- preview links carry this, so a reused slug never inherits an old link
  created_at INTEGER NOT NULL DEFAULT 0
);

-- 24 rows per calendar. An empty door (type '') shows "coming soon" once open.
CREATE TABLE IF NOT EXISTS doors (
  calendar_slug TEXT NOT NULL,
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 24),
  type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  blurb TEXT NOT NULL DEFAULT '',
  cta_label TEXT NOT NULL DEFAULT '',
  cta_url TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  code_note TEXT NOT NULL DEFAULT '',
  review_url TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  image_alt TEXT NOT NULL DEFAULT '',
  sponsor TEXT NOT NULL DEFAULT '',
  play TEXT NOT NULL DEFAULT '',
  play_items TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (calendar_slug, day)
);

-- Email reminders (double opt-in). Every row is deleted after Feb 1 of the next year.
CREATE TABLE IF NOT EXISTS reminder_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calendar_slug TEXT NOT NULL,
  email TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'America/Chicago',
  want_launch INTEGER NOT NULL DEFAULT 0,
  want_daily INTEGER NOT NULL DEFAULT 0,
  want_newsletter INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  last_sent_day INTEGER NOT NULL DEFAULT 0,
  confirm_sent_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER NOT NULL DEFAULT 0,
  unsubscribed_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (calendar_slug, email)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (k, day)
);

-- Last newsletter-list download per calendar (also created on first use by src/reminders.js).
CREATE TABLE IF NOT EXISTS newsletter_exports (
  calendar_slug TEXT PRIMARY KEY,
  last_confirmed_at INTEGER NOT NULL DEFAULT 0,
  downloaded_at INTEGER NOT NULL DEFAULT 0
);

-- The demo calendar: every door open, sample content (scripts/demo-doors.sql).
-- Add your own calendars from /admin.
INSERT OR IGNORE INTO calendars (slug, title, subtitle, theme, year, demo, published) VALUES
  ('demo', 'Advent Calendar Demo', 'One door a day from December 1 to 24, and the doors get better the closer you get to the end. Tap any door.', 'workshop', 2026, 1, 1);
