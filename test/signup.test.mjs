// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

// A stand-in database: it answers the calendar lookup and records every other query,
// so a test can prove a sign-up was (or wasn't) stored.
function fakeEnv(extra = {}) {
  const writes = [];
  const DB = {
    prepare(sql) {
      const q = {
        bind() { return q; },
        async first() {
          if (/FROM calendars/.test(sql)) return { slug: 'my-calendar', title: 'My Advent Calendar', subtitle: '', theme: 'workshop', year: new Date().getUTCFullYear() + 1, demo: 0, published: 1, home_url: '', updated_at: 0, created_at: 1 };
          writes.push(sql); return null;
        },
        async run() { writes.push(sql); return { meta: { changes: 1 } }; },
        async all() { writes.push(sql); return { results: [] }; },
      };
      return q;
    },
  };
  return { env: { DB, APP_URL: 'https://advent.example', JWT_SECRET: 'x'.repeat(48), ...extra }, writes };
}
function signup(env, origin = 'https://advent.example') {
  return worker.fetch(new Request('https://advent.example/api/c/my-calendar/remind', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.' + Math.floor(Math.random() * 250) },
    body: JSON.stringify({ email: 'reader@example.com', launch: true, daily: true, tz: 'America/Chicago' }),
  }), env);
}

test('sign-up with no email set up: a clear answer, nothing stored, nothing sent', async () => {
  const { env, writes } = fakeEnv();
  const realFetch = globalThis.fetch; let sent = 0;
  globalThis.fetch = async () => { sent++; return new Response('{}'); };
  try {
    const r = await signup(env);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { off: true });
    assert.deepEqual(writes, [], 'no row and no counter is written');
    assert.equal(sent, 0, 'no email goes out');
  } finally { globalThis.fetch = realFetch; }
});

test('sign-up from another site is refused before anything else', async () => {
  const { env, writes } = fakeEnv();
  const r = await signup(env, 'https://evil.example');
  assert.equal(r.status, 403);
  assert.deepEqual(writes, []);
});
