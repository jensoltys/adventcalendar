// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// Advent Calendar page. One file serves every calendar (/c/<slug>), standalone or
// embedded in a blog post. Doors open on the viewer's own date; the server never
// sends a locked door's contents.
(function () {
  'use strict';

  var turnstileKey = '';
  var EMAIL_ON = true; // false when the server can't send email (no Resend key set)
  var EMBEDDED = window.parent !== window;
  // Amazon-style links render only when the frame is one of your AFFILIATE_ORIGINS sites,
  // and links to your OWN_HOSTS sites get no "affiliate" label. Both come from the API.
  var FRAME_ORIGIN = (function () {
    if (!EMBEDDED) return ''; var o = '';
    try {
      if (location.ancestorOrigins && location.ancestorOrigins.length) o = location.ancestorOrigins[location.ancestorOrigins.length - 1];
      else if (document.referrer) o = new URL(document.referrer).origin;
    } catch (e) {}
    return o;
  })();
  var ON_BLOG = false;
  var OWN = [];
  var AMAZONISH = /(^|\.)(amazon\.[a-z.]+|amzn\.to|a\.co|geni\.us|lvnta\.com)$/i;

  var ORDER = [7, 15, 1, 22, 10, 4, 18, 13, 24, 3, 20, 9, 16, 6, 12, 21, 2, 11, 19, 5, 14, 23, 8, 17];
  var SPANS = { 24: 'w2 h2', 1: 'w2', 7: 'w2', 12: 'w2', 18: 'w2', 20: 'w2' };
  var WRAPS = ['wa', 'wb', 'wc', 'wd'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var I = {
    tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.5 17.3a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.2-.4-.4-2.2z"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 7v2M14 11v2M14 15v2"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>',
    deal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M12 8C10 4 6.5 4 7 6.5 7.4 8 12 8 12 8zm0 0c2-4 5.5-4 5-1.5C16.6 8 12 8 12 8z"/></svg>',
    sponsored: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.4l6-.9z"/></svg>',
    tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="12" rx="4"/><path d="M8 11v4M6 13h4"/><circle cx="15.5" cy="12" r="1" fill="currentColor"/><circle cx="17.5" cy="14.5" r="1" fill="currentColor"/></svg>',
    surprise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M4 7l16 10M20 7L4 17M9 3.5l3 2 3-2M9 20.5l3-2 3 2"/></svg>',
    lock: '<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="rgba(0,0,0,.22)"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    bow: '<svg class="bow" viewBox="0 0 40 26" aria-hidden="true"><path d="M20 13C14 2 3 1 4 9c1 6 11 4 16 4zm0 0c6-11 17-12 16-4-1 6-11 4-16 4z" fill="var(--ribbon)" stroke="rgba(0,0,0,.15)"/><circle cx="20" cy="13" r="4" fill="var(--ribbon)" stroke="rgba(0,0,0,.18)"/></svg>'
  };
  var KICKER = { tool: 'Free tool', code: 'Discount code', unlock: 'App bonus', deal: 'Deal', gift: 'Gift pick', tip: 'Tip', download: 'Free download', play: 'Play', sponsored: 'Sponsored', surprise: 'Surprise' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; } }
  function isOwn(url) {
    var h = hostOf(url).replace(/^www\./, '');
    return OWN.some(function (d) { d = String(d).toLowerCase().replace(/^www\./, ''); return h === d || h.slice(-(d.length + 1)) === '.' + d; });
  }
  function isAmazonish(url) { return AMAZONISH.test(hostOf(url)); }

  var slug = (location.pathname.match(/^\/c\/([a-z0-9-]{1,40})/) || [])[1] || '';
  var previewToken = (new URLSearchParams(location.search).get('preview') || '').slice(0, 600);
  var cal = null, doors = {}, stamps = [];
  var storeKey = '';

  // ── local date: a door opens at midnight on the viewer's own clock ──
  function localOpen(day) {
    if (!cal) return false;
    if (cal.demo) return true;
    var n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = n.getDate();
    if (y > cal.year) return true;
    if (y < cal.year) return false;
    return m === 11 && d >= day;
  }
  function canOpen(day) { var door = doors[day]; return !!door && door.open && (localOpen(day) || (cal && cal.preview)); }
  function daysUntil(day) {
    var n = new Date(); var today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((Date.UTC(cal.year, 11, day) - today) / 86400000);
  }

  // ── stamps (this browser only) ──
  function loadStamps() { try { var v = JSON.parse(localStorage.getItem(storeKey) || '[]'); stamps = Array.isArray(v) ? v.filter(function (x) { return x >= 1 && x <= 24; }) : []; } catch (e) { stamps = []; } }
  function saveStamps() { try { localStorage.setItem(storeKey, JSON.stringify(stamps)); } catch (e) {} }
  function addStamp(day) { if (stamps.indexOf(day) !== -1) return false; stamps.push(day); saveStamps(); return true; }

  // ── embed contract ──
  function postSize() {
    if (!EMBEDDED) return;
    var el = $('wrap') || document.body;
    var h = Math.ceil(el.getBoundingClientRect().bottom) + 8;
    try { parent.postMessage({ embedResize: true, height: h }, '*'); } catch (e) {}
  }
  function bringTopIntoView() {
    if (EMBEDDED) { try { parent.postMessage({ embedScrollTop: true }, '*'); } catch (e) {} }
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── rendering ──
  function tier(day) { return day === 24 ? 4 : day >= 17 ? 3 : day >= 9 ? 2 : 1; }

  function skeleton() {
    var html = '';
    ORDER.forEach(function (day) { html += '<div class="cell skel ' + (SPANS[day] || '') + '"><div class="door"></div></div>'; });
    $('grid').innerHTML = html;
  }

  function renderGrid() {
    var html = '';
    ORDER.forEach(function (day, i) {
      var open = canOpen(day), stamped = stamps.indexOf(day) !== -1;
      var door = doors[day] || {};
      var icon = open ? (I[door.type] || I.empty) : '';
      var label = 'Door ' + day + (stamped ? ', opened' : open ? ', ready to open' : ', locked until December ' + day);
      html += '<div class="cell tier' + tier(day) + ' ' + (SPANS[day] || '') + (stamped && open ? ' open' : open ? ' ready' : '') + '" data-day="' + day + '">' +
        '<button class="door" type="button" aria-label="' + label + '">' +
          '<span class="inside">' + icon + '</span>' +
          '<span class="panel ' + WRAPS[i % 4] + '"><span class="rib-v"></span><span class="rib-h"></span>' + I.bow + I.lock +
          '<span class="num">' + day + '</span></span>' +
        '</button></div>';
    });
    $('grid').innerHTML = html;
    renderStamps();
  }

  // ── Sock: fills up one door at a time, and is the stamp card ──
  var SOCK_LINES = [
    'Every door you open drops something in here.',
    "I'm a sock. I take this job very seriously.",
    "Door 24 is the big one. I'm saving room.",
    'Missed a day? Past doors stay open.',
    "Please don't put me in the wash until January.",
    'I hold 24 things. I checked.',
    "Tell a friend which door you're on. I like company.",
    "Tap a door and I'll catch whatever's inside."
  ];
  var GIFT_SPOTS = [[30, 128], [48, 132], [64, 126], [38, 114], [56, 112], [26, 100], [44, 98], [62, 96], [34, 84], [52, 82]];
  function sockLine() {
    var n = stamps.length;
    if (n === 24) return 'Stuffed. Thanks for opening every door with me.';
    if (n === 0) return cal && cal.demo ? "Tap any door. They're all open in the demo." : "Tap a door and I'll catch whatever's inside.";
    if (n >= 18) return n + ' down. I can barely see over the top.';
    if (n >= 12) return 'Past halfway. I\'m getting heavy.';
    return n + (n === 1 ? ' door' : ' doors') + ' down. Plenty of room left in here.';
  }
  function say(text) { $('sockSays').textContent = text; }
  function sockMood(cls, ms) { var el = $('sock'); el.classList.remove('gulp', 'shake', 'party'); void el.offsetWidth; el.classList.add(cls); setTimeout(function () { el.classList.remove(cls); }, ms); }
  function renderStamps() {
    $('stampbar').hidden = false;
    var n = stamps.length;
    // fill rises from the toe (y=150) to just under the cuff (y=30)
    $('sockFill').setAttribute('y', String(150 - Math.round(n / 24 * 120)));
    var g = '', shown = Math.min(GIFT_SPOTS.length, Math.ceil(n / 2.4));
    for (var k = 0; k < shown; k++) {
      var p = GIFT_SPOTS[k];
      g += '<rect x="' + (p[0] - 6) + '" y="' + (p[1] - 6) + '" width="12" height="11" rx="2" fill="' + (k % 2 ? 'var(--wrap-b)' : 'var(--gold)') + '"/>';
    }
    $('sockGifts').innerHTML = g;
    $('sockPop').innerHTML = n === 24 ? '<rect x="22" y="-6" width="16" height="16" rx="3" fill="var(--gold)"/><rect x="54" y="-12" width="18" height="18" rx="3" fill="var(--wrap-b)"/><circle cx="46" cy="0" r="7" fill="var(--wrap-c)"/>' : '';
    $('sockMouth').setAttribute('d', n === 24 ? 'M39 54q8 10 16 0z' : 'M41 55q6 6 12 0');
    $('stampN').textContent = n;
    say(sockLine());
  }
  // a tiny gift flies from the opened door into the top of the sock
  function dropGift(fromCell) {
    var sock = $('sock'); if (!sock || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var a = fromCell.getBoundingClientRect(), b = sock.getBoundingClientRect();
    var d = document.createElement('span'); d.className = 'drop';
    d.style.left = (a.left + a.width / 2 - 9) + 'px'; d.style.top = (a.top + a.height / 2 - 8) + 'px';
    document.body.appendChild(d);
    var dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height * 0.15 - (a.top + a.height / 2);
    var anim = d.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: 'translate(' + dx * 0.5 + 'px,' + (dy - 80) + 'px) scale(1.2) rotate(120deg)' }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.5) rotate(260deg)', opacity: .4 }], { duration: 650, easing: 'cubic-bezier(.3,.6,.4,1)' });
    anim.onfinish = function () { d.remove(); };
  }
  $('sock').addEventListener('click', sockTap);
  $('sock').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sockTap(); } });
  var lineIdx = 0;
  function sockTap() { sockMood('gulp', 600); say(SOCK_LINES[lineIdx++ % SOCK_LINES.length]); }

  function renderStatus() {
    var s = '';
    if (cal.preview) s = 'Preview link: every door is open for you. Visitors still see them one day at a time.';
    else if (cal.demo) s = 'This is a demo, so every door opens today.';
    else {
      var until = daysUntil(1), last = daysUntil(24);
      if (until > 0) s = 'Door 1 opens December 1. ' + until + (until === 1 ? ' sleep' : ' sleeps') + ' to go.';
      else if (last >= 0) { var today = 24 - last; s = 'Door ' + today + ' is open today.' + (today < 24 ? ' Missed one? Past doors stay open.' : ' That is the big one.'); }
      else s = 'Every door is open. Thanks for coming back all month.';
    }
    $('calStatus').textContent = s;
  }

  // A code works on its own door's day only. Past doors stay open, so a code
  // door has to say plainly when its code is spent, or a reader on Dec 10
  // copies a dead Dec 6 code and feels tricked. Viewer's own clock, like the doors.
  function codeExpired(day) {
    if (!cal || cal.demo || cal.preview) return false;
    var n = new Date(), y = n.getFullYear();
    if (y !== cal.year) return y > cal.year;
    return n.getMonth() === 11 && n.getDate() > day;
  }

  function codeBlock(door, day) {
    if (!door.code) return '';
    if (codeExpired(day)) {
      return '<div class="dc-code dc-expired"><code>' + esc(door.code) + '</code></div>' +
        '<p class="dc-when dc-when-over">This code ended at midnight after December ' + day + '. It was a one-day code, so it won\'t work now. Today\'s door might have something new for you.</p>';
    }
    return '<p class="dc-when">One day only: use it by 11:59 PM on December ' + day + ', your time.</p>' +
      '<div class="dc-code"><code id="theCode">' + esc(door.code) + '</code><button class="btn" type="button" id="copyCode">Copy code</button></div>' +
      (door.code_note ? '<p class="dc-note">' + esc(door.code_note) + '</p>' : '<p class="dc-note"></p>');
  }

  function actions(door) {
    var out = [], disc = [];
    var url = door.cta_url, label = door.cta_label || (door.type === 'tool' ? 'Open the tool' : door.type === 'code' ? 'Use the code' : 'Take a look');
    if (url && door.type === 'download') {
      var local = url.charAt(0) === '/';
      out.push('<a class="btn" href="' + esc(url) + '"' + (local ? ' download' : ' target="_blank" rel="noopener noreferrer"') + '>' + I.download + ' ' + esc(door.cta_label || 'Download it') + '</a>');
    } else if (url) {
      if (isAmazonish(url)) {
        if (ON_BLOG) {
          out.push('<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer sponsored nofollow">' + esc(label) + '</a>');
          disc.push('As an Amazon Associate I earn from qualifying purchases.');
        }
      } else if (isOwn(url)) {
        out.push('<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>');
      } else {
        out.push('<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer sponsored nofollow">' + esc(label) + '</a>');
        if (door.type !== 'sponsored') disc.push('Affiliate link. I may earn a commission.');
      }
    }
    if (door.review_url) {
      var primary = !out.length;
      out.push('<a class="btn' + (primary ? '' : ' ghost') + '" href="' + esc(door.review_url) + '" target="_blank" rel="noopener noreferrer">Read my review</a>');
    }
    return (out.length ? '<div class="dc-actions">' + out.join('') + '</div>' : '') +
      (disc.length ? '<p class="dc-disc">' + esc(disc.join(' ')) + '</p>' : '');
  }

  function renderDoor(day) {
    var door = doors[day] || {};
    var t = door.type;
    var html = '';
    if (!t) {
      html = '<div class="dc-top"><div class="dc-badge">' + I.empty + '</div><div><div class="dc-kicker">Door ' + day + '</div>' +
        '<h2 class="dc-title">Still being wrapped</h2></div></div><p class="dc-blurb">This door isn\'t ready yet. Check back a little later today.</p>';
    } else {
      if (t === 'sponsored') html += '<span class="dc-ad">Ad' + (door.sponsor ? ': sponsored by ' + esc(door.sponsor) : '') + '</span>';
      html += '<div class="dc-top"><div class="dc-badge">' + (I[t] || I.surprise) + '</div><div>' +
        '<div class="dc-kicker">Door ' + day + ' &middot; ' + esc(KICKER[t] || 'Surprise') + (cal.demo ? ' &middot; sample' : '') + '</div>' +
        '<h2 class="dc-title">' + esc(door.title || 'A little something') + '</h2></div></div>';
      if (door.image_url) html += '<img class="dc-img" src="' + esc(door.image_url) + '" alt="' + esc(door.image_alt || '') + '" loading="lazy">';
      if (door.blurb) html += '<p class="dc-blurb">' + esc(door.blurb) + '</p>';
      if (t === 'play') html += '<div class="play" id="play"></div>';
      html += codeBlock(door, day) + actions(door);
      html += shareHtml(day);
      html += nudgeHtml(door, day);
    }
    if (!cal.demo && day < 24) html += '<p class="dc-next">Door ' + (day + 1) + ' opens December ' + (day + 1) + '.</p>';
    else if (day === 24) html += '<p class="dc-next">That\'s the last door. Thanks for opening them with me.</p>';
    $('doorCard').innerHTML = html;
    var copy = $('copyCode');
    if (copy) copy.addEventListener('click', function () { copyCode(door.code, copy); });
    if (t === 'play') mountPlay(door);
    wireShare(day);
    var nr = $('nudgeRemind'); if (nr) nr.addEventListener('click', function () {
      // back to the grid (the door was its own history entry), then show the reminder buttons
      if (history.state && history.state.view === 'door') history.back(); else show('grid', null, true);
      setTimeout(function () { var r = $('remind'); if (r) { r.classList.add('flash'); if (!EMBEDDED) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 120);
    });
  }

  // ── nudges: one quiet line under the gift, different every door ──
  function nudgeHost(u) { try { return u && /^https?:/.test(u) ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch (e) { return ''; } }
  function nudgeHtml(door, day) {
    if (door.type === 'sponsored') return '';
    var all = window.ADVENT_NUDGES || {};
    var pool = all[cal.theme] || all.all || [];
    // the share bar already asks for a share on every door, so the nudge never repeats it
    function usable(n) { return n && n.kind !== 'share' && (n.kind !== 'remind' || (!cal.demo && $('remind') && !$('remind').hidden)); }
    var n;
    if (pool.length >= 24) {
      // one entry per door. If it can't show (reminder hidden) or it pitches what this
      // door already offers, the door gets the fallback note instead (if you set one).
      n = pool[day - 1];
      var doorHost = nudgeHost(door.cta_url);
      if (!usable(n) || (doorHost && nudgeHost(n.url) === doorHost)) n = all.fallback;
    } else {
      pool = pool.filter(usable);
      n = pool[(day - 1) % pool.length];
    }
    if (!n) return '';
    var btn;
    if (n.kind === 'remind') btn = '<button class="nudge-link" type="button" id="nudgeRemind">' + esc(n.label) + '</button>';
    else btn = '<a class="nudge-link" href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer">' + esc(n.label) + '</a>';
    return '<aside class="nudge" aria-label="A note"><span class="nudge-text">' + esc(n.text) + '</span> ' + btn + (n.kind === 'mine' ? '<span class="nudge-disc">My product.</span>' : '') + '</aside>';
  }
  // ── sharing: "I opened door N", with that door's picture as the link preview ──
  var THEMES = ['workshop', 'plum', 'jen8n', 'meadow', 'arcade'];
  function shareKey(day) { return stamps.length === 24 && day === 24 ? 'all' : String(day); }
  function shareLink(key) { return location.origin + '/c/' + cal.slug + (key === 'all' ? '/done' : '/door/' + key); }
  function shareImg(key) { return '/share/' + (THEMES.indexOf(cal.theme) !== -1 ? cal.theme : 'workshop') + '/' + key + '.jpg'; }
  function shareText(key) {
    return key === 'all' ? 'I opened all 24 doors of ' + cal.title + '! There\'s still time to open yours:'
      : 'I just opened door ' + key + ' of ' + cal.title + '. There\'s a free surprise behind every door until December 24. Open yours:';
  }
  function shareHtml(day) {
    var key = shareKey(day);
    return '<div class="sharebar"><p><b>' + (key === 'all' ? 'You opened every door.' : 'Door ' + day + ' is open.') + '</b> Tell people, so they can open theirs too.</p>' +
      '<div class="share-btns"><button class="btn" type="button" id="shareBtn">Share it</button>' +
      '<button class="btn ghost" type="button" id="copyLink">Copy the link</button>' +
      '<a class="btn ghost" id="savePic" href="' + esc(shareImg(key)) + '" download="advent-door-' + key + '.jpg">Save the picture</a></div></div>';
  }
  function wireShare(day) {
    var key = shareKey(day), b = $('shareBtn'); if (!b) return;
    b.addEventListener('click', function () {
      var data = { title: cal.title, text: shareText(key), url: shareLink(key) };
      if (!navigator.share) return copyLinkNow(key);
      // phones can share the picture itself (great for stories); fall back to the link
      fetch(shareImg(key)).then(function (r) { return r.blob(); }).then(function (blob) {
        var f = new File([blob], 'advent-door-' + key + '.jpg', { type: 'image/jpeg' });
        var withFile = { title: data.title, text: data.text + ' ' + data.url, files: [f] };
        return navigator.share(navigator.canShare && navigator.canShare(withFile) ? withFile : data);
      }).then(function () { say('Thanks for sharing. I like company.'); sockMood('party', 1400); }, function () {});
    });
    $('copyLink').addEventListener('click', function () { copyLinkNow(key); });
  }
  function copyLinkNow(key) {
    var text = shareText(key) + ' ' + shareLink(key);
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Copied. Paste it anywhere.'); }, function () { toast(shareLink(key)); });
  }

  // ── Play doors: tiny games that run inside the opened door ──
  function playItems(door) {
    return String(door.play_items || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 30);
  }
  function mountPlay(door) {
    var box = $('play'), items = playItems(door);
    if (!items.length) { box.innerHTML = '<p class="play-empty">This game is still being set up. Check back soon.</p>'; return; }
    var kind = door.play || 'pick';
    if (kind === 'spin') return playSpin(box, items);
    if (kind === 'scratch') return playScratch(box, items);
    if (kind === 'shake') return playShake(box, items);
    if (kind === 'wallpaper') return playWallpaper(box, items);
    return playPick(box, items);
  }
  function pickNot(items, last) { if (items.length < 2) return 0; var i; do { i = Math.floor(Math.random() * items.length); } while (i === last); return i; }

  function playPick(box, items) {
    var last = -1;
    box.innerHTML = '<div class="pick-card" id="pickCard" aria-live="polite"><span class="pick-q">?</span></div><button class="btn" type="button" id="pickBtn">Draw a card</button>';
    $('pickBtn').addEventListener('click', function () {
      last = pickNot(items, last);
      var c = $('pickCard'); c.classList.remove('flip'); void c.offsetWidth; c.classList.add('flip');
      setTimeout(function () { c.innerHTML = '<span class="pick-a">' + esc(items[last]) + '</span>'; }, 180);
      this.textContent = 'Draw another';
      postSize();
    });
  }

  function playSpin(box, items) {
    var segs = items.slice(0, 12), n = segs.length, turn = 0, busy = false;
    box.innerHTML = '<div class="spin-wrap"><span class="spin-pointer" aria-hidden="true"></span><canvas class="spin-wheel" id="wheel" width="320" height="320" aria-hidden="true"></canvas></div>' +
      '<p class="spin-result" id="spinResult" aria-live="polite"></p><button class="btn" type="button" id="spinBtn">Spin</button>';
    var cv = $('wheel'), ctx = cv.getContext('2d'), st = getComputedStyle(document.documentElement);
    var colors = ['--wrap-a', '--wrap-b', '--wrap-c', '--wrap-d'].map(function (v) { return st.getPropertyValue(v).trim(); });
    var r = 160, step = Math.PI * 2 / n;
    for (var i = 0; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(r, r); ctx.arc(r, r, r - 2, i * step - Math.PI / 2, (i + 1) * step - Math.PI / 2); ctx.closePath();
      ctx.fillStyle = colors[i % 4] || '#C97B5F'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.translate(r, r); ctx.rotate((i + .5) * step - Math.PI / 2);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      // shrink the label until it fits between the rim and the hub, then trim as a last resort
      var room = r - 14 - 30, label = segs[i], fs = 14;
      ctx.font = '700 ' + fs + 'px Figtree, system-ui, sans-serif';
      while (ctx.measureText(label).width > room && fs > 10) { fs--; ctx.font = '700 ' + fs + 'px Figtree, system-ui, sans-serif'; }
      while (ctx.measureText(label).width > room && label.length > 4) label = label.slice(0, -2).trim() + '\u2026';
      ctx.fillText(label, r - 14, 0); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(r, r, 18, 0, Math.PI * 2); ctx.fillStyle = st.getPropertyValue('--gold').trim() || '#E8B04B'; ctx.fill();
    $('spinBtn').addEventListener('click', function () {
      if (busy) return; busy = true; this.disabled = true;
      var pick = Math.floor(Math.random() * n);
      // the pointer is at the top, so land the middle of the picked slice there
      var target = 360 * 5 + (360 - (pick + .5) * (360 / n));
      turn = turn - (turn % 360) + target;
      cv.style.transform = 'rotate(' + turn + 'deg)';
      var btn = this;
      // the reader may have gone Back mid-spin, so the result box can be gone
      setTimeout(function () { var out = $('spinResult'); if (out) out.textContent = segs[pick]; busy = false; btn.disabled = false; btn.textContent = 'Spin again'; postSize(); }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 3200);
    });
  }

  function playScratch(box, items) {
    var answer = items[Math.floor(Math.random() * items.length)];
    box.innerHTML = '<div class="scratch" id="scratch"><p class="scratch-text">' + esc(answer) + '</p><canvas id="scratchCv" aria-hidden="true"></canvas></div>' +
      '<p class="scratch-hint">Scratch the paper with your finger or mouse.</p><button class="btn ghost" type="button" id="scratchShow">Just show me</button>';
    var wrap = $('scratch'), cv = $('scratchCv'), ctx = cv.getContext('2d');
    var done = false, down = false, rubs = 0, dpr = window.devicePixelRatio || 1;
    function size() {
      // offset sizes, not the bounding box: the card is still scaling in when this runs
      var rc = { width: wrap.offsetWidth, height: wrap.offsetHeight }; cv.width = rc.width * dpr; cv.height = rc.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var st = getComputedStyle(document.documentElement);
      var g = ctx.createLinearGradient(0, 0, rc.width, rc.height);
      g.addColorStop(0, st.getPropertyValue('--gold').trim() || '#E8B04B'); g.addColorStop(1, st.getPropertyValue('--gold-deep').trim() || '#B9812A');
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = g; ctx.fillRect(0, 0, rc.width, rc.height);
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '800 18px Bricolage Grotesque, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Scratch here', rc.width / 2, rc.height / 2);
    }
    function reveal() { if (done) return; done = true; cv.classList.add('gone'); $('scratchShow').hidden = true; box.querySelector('.scratch-hint').textContent = ''; sockMood('gulp', 600); }
    function at(e) { var rc = cv.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top]; }
    function rub(e) {
      if (!down || done) return; e.preventDefault();
      var p = at(e); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(p[0], p[1], 22, 0, Math.PI * 2); ctx.fill();
      if (++rubs % 12 === 0) check();
    }
    function check() {
      var data = ctx.getImageData(0, 0, cv.width, cv.height).data, clear = 0, total = 0;
      for (var i = 3; i < data.length; i += 64) { total++; if (data[i] === 0) clear++; }
      if (clear / total > .35) reveal();
    }
    size();
    cv.addEventListener('pointerdown', function (e) { down = true; cv.setPointerCapture(e.pointerId); rub(e); });
    cv.addEventListener('pointermove', rub);
    cv.addEventListener('pointerup', function () { down = false; check(); });
    cv.addEventListener('pointercancel', function () { down = false; });
    $('scratchShow').addEventListener('click', reveal);
  }

  // Each line is "clue | answer" (or just the answer). Three shakes give the clue, then the lid comes off.
  function playShake(box, items) {
    var last = -1, shakes = 0, cur;
    function next() {
      last = pickNot(items, last); shakes = 0;
      var parts = items[last].split('|'); cur = { clue: parts.length > 1 ? parts[0].trim() : '', answer: parts[parts.length - 1].trim() };
      $('shakeBox').classList.remove('open'); $('shakeSays').textContent = 'Something is in here. Shake it.';
      $('shakeBtn').textContent = 'Shake it'; $('shakeOpen').hidden = true;
    }
    box.innerHTML = '<div class="shake-box" id="shakeBox" aria-hidden="true"><span class="sb-lid"></span><span class="sb-base"></span><span class="sb-rib"></span></div>' +
      '<p class="shake-says" id="shakeSays" aria-live="polite"></p>' +
      '<div class="dc-actions"><button class="btn" type="button" id="shakeBtn">Shake it</button><button class="btn ghost" type="button" id="shakeOpen" hidden>Open it</button></div>';
    var sb = $('shakeBox'), still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function open() { sb.classList.add('open'); $('shakeSays').textContent = cur.answer; $('shakeOpen').hidden = true; $('shakeBtn').textContent = 'Wrap another'; sockMood('gulp', 600); postSize(); }
    $('shakeBtn').addEventListener('click', function () {
      if (sb.classList.contains('open')) return next();
      shakes++;
      if (!still) { sb.classList.remove('rattle'); void sb.offsetWidth; sb.classList.add('rattle'); }
      if (shakes < 3) $('shakeSays').textContent = shakes === 1 ? 'Rattle rattle. One more.' : 'It thumps a little. Keep going.';
      else { $('shakeSays').textContent = cur.clue ? 'Clue: ' + cur.clue : 'Ready when you are.'; $('shakeOpen').hidden = false; }
      postSize();
    });
    $('shakeOpen').addEventListener('click', open);
    next();
  }

  // Lines are suggested words. The reader types a word, picks a color, saves a 1080x1920 lock screen.
  function playWallpaper(box, items) {
    var st = getComputedStyle(document.documentElement);
    var colors = ['--wrap-a', '--wrap-b', '--wrap-c', '--wrap-d', '--bg'].map(function (v) { return st.getPropertyValue(v).trim(); }).filter(Boolean);
    var color = colors[0];
    box.innerHTML = '<label class="wp-label" for="wpWord">Your word</label>' +
      '<input class="wp-word" id="wpWord" maxlength="14" autocomplete="off" placeholder="' + esc(items[0]) + '">' +
      '<div class="wp-ideas" role="group" aria-label="Need an idea?">' + items.slice(0, 8).map(function (w) { return '<button class="wp-idea" type="button">' + esc(w) + '</button>'; }).join('') + '</div>' +
      '<div class="wp-colors" role="radiogroup" aria-label="Background color">' + colors.map(function (c, i) {
        return '<button class="wp-swatch" type="button" role="radio" aria-checked="' + (i === 0) + '" aria-label="Color ' + (i + 1) + '" data-c="' + c + '"></button>'; }).join('') + '</div>' +
      '<canvas class="wp-preview" id="wpCv" width="1080" height="1920" role="img" aria-label="Preview of your lock screen"></canvas>' +
      '<div class="dc-actions"><a class="btn" id="wpSave" href="#" download="word-of-the-year.png">' + I.download + ' Save my lock screen</a></div>';
    var cv = $('wpCv'), ctx = cv.getContext('2d'), input = $('wpWord');
    function word() { return (input.value.trim() || items[0]).slice(0, 14); }
    function draw() {
      var w = word(), year = (cal.year || new Date().getFullYear()) + 1;
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1080, 1920);
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      for (var i = 0; i < 26; i++) { ctx.beginPath(); ctx.arc((i * 337) % 1080, (i * 571) % 1920, 6 + (i % 4) * 5, 0, Math.PI * 2); ctx.fill(); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '700 54px Figtree, system-ui, sans-serif';
      ctx.fillText('My word for ' + year, 540, 1060);
      var fs = 240; ctx.font = '800 ' + fs + 'px "Bricolage Grotesque", system-ui, sans-serif';
      while (ctx.measureText(w).width > 940 && fs > 80) { fs -= 8; ctx.font = '800 ' + fs + 'px "Bricolage Grotesque", system-ui, sans-serif'; }
      ctx.fillStyle = '#fff'; ctx.fillText(w, 540, 1220);
      $('wpSave').setAttribute('download', 'word-of-the-year-' + w.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png');
    }
    input.addEventListener('input', draw);
    box.querySelectorAll('.wp-idea').forEach(function (b) { b.addEventListener('click', function () { input.value = b.textContent; draw(); }); });
    // Set from script: the page's CSP blocks inline style attributes.
    box.querySelectorAll('.wp-swatch').forEach(function (b) { b.style.background = b.getAttribute('data-c'); b.addEventListener('click', function () {
      color = b.getAttribute('data-c'); box.querySelectorAll('.wp-swatch').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); }); draw(); }); });
    $('wpSave').addEventListener('click', function (e) {
      var a = this; if (a.getAttribute('href') !== '#') return;
      e.preventDefault();
      cv.toBlob(function (blob) { a.href = URL.createObjectURL(blob); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.href = '#'; }, 4000); sockMood('gulp', 600); }, 'image/png');
    });
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(draw);
    draw();
  }

  function copyCode(code, btn) {
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy code'; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, function () { selectCode(); toast('Press and hold the code to copy it.'); });
    } else { selectCode(); toast('Press and hold the code to copy it.'); }
  }
  function selectCode() { var el = $('theCode'); if (!el) return; var r = document.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }

  // ── views (single choke point, Back-button safe) ──
  function show(view, day, fromHistory) {
    $('gridView').hidden = view !== 'grid';
    $('doorView').hidden = view !== 'door';
    $('msgView').hidden = view !== 'msg';
    if (view === 'door') {
      renderDoor(day);
      if (!fromHistory) history.pushState({ view: 'door', day: day }, '', location.pathname + location.search);
      bringTopIntoView();
      setTimeout(function () { var b = $('backBtn'); if (b) b.focus({ preventScroll: true }); }, 50);
    } else if (view === 'grid') {
      renderGrid();
    }
    postSize();
  }

  window.addEventListener('popstate', function (e) {
    var st = e.state || {};
    if (st.view === 'door' && canOpen(st.day)) show('door', st.day, true);
    else show('grid', null, true);
  });

  // ── interactions ──
  var opening = false;
  $('grid').addEventListener('click', function (e) {
    var cell = e.target.closest('.cell[data-day]');
    if (!cell || opening) return;
    var day = Number(cell.getAttribute('data-day'));
    if (!canOpen(day)) return tease(cell, day);
    var first = addStamp(day);
    if (!first) return show('door', day);
    opening = true;
    cell.classList.remove('ready'); cell.classList.add('open');
    dropGift(cell);
    setTimeout(function () { renderStamps(); sockMood(day === 24 || stamps.length === 24 ? 'party' : 'gulp', day === 24 ? 1800 : 600); }, 600);
    burst(cell, day === 24 ? 3 : day >= 17 ? 2 : 1);
    if (stamps.length === 24) setTimeout(function () { burst(document.body, 3); toast('All 24 doors opened. Your stamp card is full.'); }, 700);
    setTimeout(function () { opening = false; show('door', day); }, 1150);
  });

  function tease(cell, day) {
    cell.classList.remove('wiggle'); void cell.offsetWidth; cell.classList.add('wiggle');
    var old = cell.querySelector('.tip'); if (old) old.remove();
    var n = daysUntil(day);
    var tip = document.createElement('span');
    tip.className = 'tip';
    tip.textContent = n === 1 ? 'Not yet. Opens tomorrow.' : 'Not yet. Opens ' + MONTHS[11] + ' ' + day + '.';
    cell.appendChild(tip);
    sockMood('shake', 500); say(n === 1 ? 'That one opens tomorrow. I already checked.' : 'Still wrapped. That one opens December ' + day + '.');
    setTimeout(function () { tip.remove(); cell.classList.remove('wiggle'); }, 1700);
  }

  $('backBtn').addEventListener('click', function () {
    if (history.state && history.state.view === 'door') history.back();
    else show('grid', null, true);
  });

  $('resetDemo').addEventListener('click', function () {
    stamps = []; saveStamps(); renderGrid(); postSize(); say('All empty again. Ready when you are.');
  });

  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // ── confetti, scaled to the door ──
  function burst(fromEl, size) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cv = $('confetti'), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var r = fromEl.getBoundingClientRect();
    var ox = fromEl === document.body ? innerWidth / 2 : r.left + r.width / 2;
    var oy = fromEl === document.body ? innerHeight / 3 : r.top + r.height / 2;
    var styles = getComputedStyle(document.documentElement);
    var colors = ['--gold', '--wrap-a', '--wrap-b', '--accent', '--ink'].map(function (v) { return styles.getPropertyValue(v).trim() || '#E8B04B'; });
    var parts = [], n = [26, 60, 130][size - 1];
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * (4 + size * 2.5);
      parts.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, s: 4 + Math.random() * 5, c: colors[i % colors.length], r: Math.random() * 6, vr: (Math.random() - .5) * .4, life: 0 });
    }
    cv.classList.add('on');
    var frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(function (p) {
        p.vy += .18; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - p.life / 110);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      });
      if (++frames < 110) requestAnimationFrame(tick); else { ctx.clearRect(0, 0, innerWidth, innerHeight); cv.classList.remove('on'); }
    })();
  }

  // ── reminders ──
  function wireReminders() {
    if (cal.demo || cal.preview) return;
    var start = cal.year + '1201T090000', end = cal.year + '1201T091500';
    var page = location.origin + '/c/' + cal.slug;
    $('icsBtn').href = '/c/' + encodeURIComponent(cal.slug) + '/reminders.ics';
    $('gcalBtn').href = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent("Open today's door: " + cal.title) +
      '&dates=' + start + '/' + end +
      '&recur=' + encodeURIComponent('RRULE:FREQ=DAILY;COUNT=24') +
      '&details=' + encodeURIComponent('A new door opened today. ' + page);
    $('remind').hidden = false;
  }

  // ── email reminders (sign-up box under the stocking) ──
  var NEWSLETTER = '';
  function wireEmailSignup() {
    var f = $('esign');
    if (cal.demo || !EMAIL_ON) { f.hidden = true; return; }
    if (f.dataset.wired) { f.hidden = false; return; }
    var n = new Date();
    if (n.getFullYear() > cal.year || (n.getFullYear() === cal.year && n.getMonth() === 11 && n.getDate() > 24)) { f.hidden = true; return; }
    f.dataset.wired = '1';
    // The newsletter box shows only when NEWSLETTER_NAME is set.
    var newsRow = $('esNews').closest('label');
    if (NEWSLETTER) { $('esNewsLabel').textContent = 'Also send me the ' + NEWSLETTER + ' newsletter'; newsRow.hidden = false; }
    else { $('esNews').checked = false; newsRow.hidden = true; }
    f.hidden = false;
    function say(t) { $('esMsg').textContent = t; postSize(); }
    function tsToken() { try { return (tsId !== null && window.turnstile && window.turnstile.getResponse(tsId)) || ''; } catch (x) { return ''; } }
    // Turnstile bot check, loaded only once someone starts filling in the box.
    var tsId = null, tsLoading = false;
    function loadTurnstile() {
      if (!turnstileKey || tsLoading) return;
      tsLoading = true;
      window.adventTsReady = function () {
        var box = $('esTs'); box.hidden = false;
        tsId = window.turnstile.render(box, { sitekey: turnstileKey, size: 'flexible', appearance: 'interaction-only', callback: postSize, 'error-callback': postSize });
        postSize();
      };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=adventTsReady';
      s.async = true; document.head.appendChild(s);
    }
    $('esEmail').addEventListener('focus', loadTurnstile);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('esGo'); if (btn.disabled) return;
      if (turnstileKey && !tsToken()) { loadTurnstile(); say('One second, checking you\'re a person. Try again in a moment.'); return; }
      var email = $('esEmail').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Add your email first.'); $('esEmail').focus(); return; }
      if (!$('esLaunch').checked && !$('esDaily').checked) { say('Pick at least one reminder.'); return; }
      var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (x) {}
      btn.disabled = true; say('Sending...');
      fetch('/api/c/' + encodeURIComponent(cal.slug) + '/remind', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, launch: $('esLaunch').checked, daily: $('esDaily').checked, newsletter: $('esNews').checked, tz: tz, website: $('esWebsite').value, preview: previewToken || undefined, ts: tsToken() })
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          var d = res.d || {};
          if (res.ok && d.ok) { f.classList.add('done'); say('Check your email and tap the button to confirm. Nothing gets sent until you do.'); return; }
          if (d.full) { f.classList.add('done'); say('Email reminders are full for this year. Use the calendar buttons below for a daily reminder instead.'); return; }
          if (d.busy) { say("We've sent all the email we can for today. Try again tomorrow, or use the calendar buttons below."); return; }
          if (d.closed) { f.classList.add('done'); say('Reminders are closed for this year.'); return; }
          if (d.off) { f.classList.add('done'); say("Email reminders aren't turned on for this calendar. Use the calendar buttons below for a daily reminder instead."); return; }
          say(d.error || 'Something went wrong. Try again in a minute.');
        }, function () { say("Can't reach the calendar. Check your connection and try again."); })
        .then(function () { btn.disabled = false; if (tsId !== null && window.turnstile) window.turnstile.reset(tsId); });
    });
  }

  function showMsg(title, body, retry) {
    $('msgCard').innerHTML = '<h2>' + esc(title) + '</h2><p>' + esc(body) + '</p>' + (retry ? '<button class="btn" type="button" id="retryBtn">Try again</button>' : '');
    show('msg');
    var b = $('retryBtn'); if (b) b.addEventListener('click', load);
  }

  // ── boot ──
  function load() {
    skeleton();
    $('gridView').hidden = false; $('doorView').hidden = true; $('msgView').hidden = true;
    if (!slug) { showMsg('No calendar here', 'This link is missing the calendar name.'); return; }
    fetch('/api/c/' + encodeURIComponent(slug) + (previewToken ? '?preview=' + encodeURIComponent(previewToken) : ''), { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 404) { showMsg('This calendar isn\'t open yet', 'Check back closer to December 1.'); return null; }
        if (!r.ok) throw new Error('server');
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        cal = data.calendar; cal.preview = !!data.preview; turnstileKey = data.turnstile || '';
        var site = data.site || {};
        OWN = site.own || []; NEWSLETTER = site.newsletter || '';
        ON_BLOG = !!FRAME_ORIGIN && (site.blogs || []).indexOf(FRAME_ORIGIN) !== -1;
        EMAIL_ON = data.email !== false;
        // A shared door link opened on its own goes to the post the calendar lives in. replace(), so Back doesn't bounce them here again. Inside the post's
        // iframe it stays put and shows the friend line.
        var shared = location.pathname.match(/\/c\/[a-z0-9-]+\/(?:door\/(\d{1,2})|(done))/);
        if (shared && !EMBEDDED && !cal.preview && /^https:\/\//.test(cal.home_url || '')) {
          var dest = new URL(cal.home_url);
          dest.searchParams.set('advent_door', shared[2] ? 'all' : shared[1]);
          dest.hash = 'advent';
          location.replace(dest.toString());
          return;
        }
        doors = {}; data.doors.forEach(function (d) { doors[d.day] = d; });
        storeKey = 'advent:' + cal.slug + ':' + cal.year + (cal.preview ? ':preview' : '');
        loadStamps();
        document.documentElement.setAttribute('data-theme', cal.theme || 'workshop');
        document.title = cal.title;
        $('calTitle').textContent = cal.title;
        $('calSub').textContent = cal.subtitle || '';
        $('demoTools').hidden = !cal.demo;
        document.documentElement.classList.toggle('is-demo', !!cal.demo);
        renderStatus();
        wireReminders();
        wireEmailSignup();
        var arrived = location.pathname.match(/\/c\/[a-z0-9-]+\/(?:door\/(\d{1,2})|(done))/);
        if (arrived) {
          $('calStatus').textContent = arrived[2] ? 'A friend opened all 24 doors. Your turn.' : 'A friend just opened door ' + arrived[1] + '. Your turn.';
          // keep the visitor on the calendar's own address from here on
          history.replaceState({ view: 'grid' }, '', '/c/' + cal.slug + location.search);
        }
        var st = history.state || {};
        if (st.view === 'door' && canOpen(st.day)) show('door', st.day, true);
        else { history.replaceState({ view: 'grid' }, '', location.pathname + location.search); show('grid', null, true); }
        // A shared door link opens that door if it's already open for this visitor.
        // The grid stays underneath as its own history entry, so Back lands on it.
        var sharedDay = arrived && arrived[1] ? Number(arrived[1]) : 0;
        if (sharedDay >= 1 && sharedDay <= 24 && canOpen(sharedDay)) {
          if (addStamp(sharedDay)) renderStamps();
          show('door', sharedDay);
        }
      })
      .catch(function () { showMsg('Can\'t reach the calendar', 'Check your connection and try again.', true); });
  }

  $('yr').textContent = new Date().getFullYear();

  if (EMBEDDED) {
    document.documentElement.classList.add('is-embedded');
    document.querySelectorAll('.standalone-only').forEach(function (el) { el.remove(); });
    window.addEventListener('load', postSize);
    if (window.ResizeObserver) { var ro = new ResizeObserver(postSize); var wrapEl = document.querySelector('.wrap'); if (wrapEl) ro.observe(wrapEl); ro.observe(document.body); }
    else window.addEventListener('resize', postSize);
  }
  load();
})();
