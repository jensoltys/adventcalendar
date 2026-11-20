// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// Advent admin. Talks to /api/admin/* with the ADMIN_API_TOKEN you paste in once per tab.
// Views go through one show() so Back always lands where you just were.
(function () {
  'use strict';
  var ORIGIN = location.origin;
  var TOKEN_KEY = 'advent-admin-token';
  var token = '';
  try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  var TYPE_LABEL = { tool: 'Free tool', code: 'Discount code', unlock: 'App bonus', deal: 'Deal', gift: 'Gift pick', tip: 'Tip', download: 'Free download', play: 'Play', sponsored: 'Sponsored', surprise: 'Surprise' };
  var FIELDS = ['type', 'title', 'blurb', 'cta_label', 'cta_url', 'code', 'code_note', 'review_url', 'image_url', 'image_alt', 'sponsor', 'play', 'play_items'];
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // The five looks in public/calendar.css. Swatch colors live in admin.css.
  var LOOKS = { workshop: 'Pine', plum: 'Plum', jen8n: 'Blackberry', meadow: 'Meadow', arcade: 'Arcade' };
  function looksHtml(name, picked) {
    return Object.keys(LOOKS).map(function (k) {
      return '<label class="look"><input type="radio" name="' + name + '" value="' + k + '"' + (k === picked ? ' checked' : '') + '>' +
        '<span class="mini lk-' + k + '"><i></i><i></i><i></i><i class="big"></i></span>' +
        '<b>' + esc(LOOKS[k]) + '</b></label>';
    }).join('');
  }
  var calendars = [], current = null, doors = [], editing = null;

  function api(path, opts) {
    opts = opts || {};
    var headers = { Authorization: 'Bearer ' + token };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch('/api/admin/' + path, { method: opts.method || 'GET', credentials: 'omit', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401) { askForToken("That admin token didn't work. Paste it again."); throw new Error('session'); }
          if (!r.ok) throw new Error(d.error || (r.status >= 500 ? 'Something went wrong on our end. Try again in a minute.' : "That didn't work. Try again."));
          return d;
        });
      }, function () { throw new Error("Can't reach the server. Check your connection and try again."); });
  }
  var toastTimer;
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400); }
  function msg(text, kind) { var el = $('doorMsg'); el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
  function guard(btn, fn) { return function (e) { if (e) e.preventDefault(); if (btn.disabled) return; btn.disabled = true; Promise.resolve().then(fn).catch(function () {}).then(function () { btn.disabled = false; }); }; }

  function show(view, state, fromHistory) {
    $('dashView').hidden = view !== 'dash';
    $('editView').hidden = view !== 'edit';
    $('addView').hidden = view !== 'add';
    if (!fromHistory && state) history.pushState(state, '', location.pathname);
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', function (e) {
    var st = e.state || {};
    if (st.view === 'add') { openAdd(true); return; }
    var known = calendars.some(function (c) { return c.slug === st.slug; });
    var slug = known ? st.slug : (calendars[0] && calendars[0].slug);
    if (!slug) return;
    if (!known) st = {};
    openCalendar(slug, true).then(function () { if (st.view === 'door' && st.day) openDoor(st.day, true); });
  });

  function renderTabs() {
    $('tabs').innerHTML = calendars.map(function (c) {
      var name = c.demo ? 'Demo' : c.title.replace(/^The /, '').replace(/ Advent Calendar$/, '');
      return '<button class="tab" role="tab" type="button" data-slug="' + esc(c.slug) + '" aria-selected="false">' + esc(name) + '</button>';
    }).join('') + '<button class="tab add" type="button" id="addTab">+ Add a calendar</button>';
  }
  $('tabs').addEventListener('click', function (e) {
    if (e.target.closest('#addTab')) { openAdd(); return; }
    var b = e.target.closest('.tab'); if (!b) return;
    var slug = b.getAttribute('data-slug');
    if (current && current.slug === slug) return;
    openCalendar(slug).then(function () { history.pushState({ view: 'cal', slug: slug }, '', location.pathname); });
  });

  function openCalendar(slug, fromHistory) {
    if (current && current.slug === slug && doors.length) { renderCalendar(); show('dash', null, true); return Promise.resolve(); }
    $('calPanel').innerHTML = '<div class="panel"><div class="skel"></div></div><div class="doors">' + new Array(9).join('<div class="skel"></div>') + '</div>';
    show('dash', null, true);
    return api('c/' + encodeURIComponent(slug)).then(function (d) { current = d.calendar; doors = d.doors; renderCalendar(); })
      .catch(function (e) {
        if (e.message === 'session') return;
        $('calPanel').innerHTML = '<div class="panel"><p>' + esc(e.message) + '</p><br><button class="btn" type="button" id="retryCal">Try again</button></div>';
        $('retryCal').addEventListener('click', function () { current = null; openCalendar(slug, true); });
      });
  }

  function embedSnippet(c) {
    var id = 'advent-' + c.slug;
    // A shared door link lands on the post with ?advent_door=N, and the frame opens on that door.
    return '<!-- wp:html -->\n<div id="advent" style="width:min(94%, 1100px);margin:1.5rem auto;scroll-margin-top:80px;">\n' +
      '<iframe id="' + id + '" src="' + ORIGIN + '/c/' + c.slug + '" title="' + c.title.replace(/"/g, '') + '" loading="lazy" allow="clipboard-write; web-share" scrolling="no" style="border:0;width:100%;min-height:560px;overflow:hidden;"></iframe>\n' +
      '<script>\n(function(){\n  var q=new URLSearchParams(location.search).get(\'advent_door\'),g=document.getElementById(\'' + id + '\');\n' +
      '  if(g&&q&&/^(all|[1-9]|1[0-9]|2[0-4])$/.test(q))g.src=\'' + ORIGIN + '/c/' + c.slug + '/\'+(q===\'all\'?\'done\':\'door/\'+q);\n' +
      '  window.addEventListener(\'message\',function(e){\n    if(e.origin!==\'' + ORIGIN + '\')return;\n    var d=e.data,f=document.getElementById(\'' + id + '\');if(!d||!f)return;\n' +
      '    if(d.embedScrollTop){requestAnimationFrame(function(){var t=f.getBoundingClientRect().top;if(t<0||t>window.innerHeight*0.5)window.scrollTo({top:window.scrollY+t-80,behavior:\'smooth\'});});return;}\n' +
      '    if(!d.embedResize||!d.height)return;\n    f.style.height=d.height+\'px\';\n  });\n})();\n</' + 'script>\n</div>\n<!-- /wp:html -->';
  }

  function renderCalendar() {
    var c = current;
    document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', t.getAttribute('data-slug') === c.slug ? 'true' : 'false'); });
    var filled = doors.filter(function (d) { return d.type; }).length;
    $('calPanel').innerHTML = '<div class="panel">' +
      '<h2>' + esc(c.title) + '</h2>' +
      '<p>' + (c.demo ? "The demo opens every door no matter the date, so people can see how it works." : "Doors open on each visitor's own date, December 1 to 24, " + c.year + '.') + '</p>' +
      '<div class="progress" aria-hidden="true"><i id="bar"></i></div>' +
      '<p><strong>' + filled + ' of 24 doors filled.</strong> ' + (filled === 24 ? 'Every door is ready.' : filled ? 'Tap a door below to fill the next one.' : 'Tap a door below to fill the first one.') + '</p>' +
      '<form class="meta" id="calForm" novalidate>' +
        '<div class="field"><label for="c_title">Calendar title</label><input id="c_title" maxlength="100" value="' + esc(c.title) + '"></div>' +
        '<div class="field"><label for="c_sub">Line under the title</label><input id="c_sub" maxlength="200" value="' + esc(c.subtitle) + '"></div>' +
        '<div class="field full"><label for="c_home">Post link</label><input id="c_home" type="url" inputmode="url" maxlength="300" placeholder="https://" value="' + esc(c.home_url || '') + '"><span class="hint">The page on your site where this calendar is embedded. Shared door links land there. Leave it blank if you don\'t embed it. The site has to be in your HOME_HOSTS setting.</span></div>' +
        '<fieldset class="looks"><legend>Look</legend>' + looksHtml('c_theme', c.theme) + '</fieldset>' +
        '<div class="row"><label class="switch"><input type="checkbox" id="c_pub"' + (c.published ? ' checked' : '') + '> Live for visitors</label>' +
          '<button class="btn small" type="submit" id="saveCal">Save</button>' +
          '<button class="btn ghost small" type="button" id="previewCal">Preview every door</button>' +
          '<a class="btn ghost small" href="' + ORIGIN + '/c/' + esc(c.slug) + '" target="_blank" rel="noopener noreferrer">Open as a visitor</a></div>' +
      '</form></div>' +
      '<ul class="doors" aria-label="Doors">' + doors.map(function (d) {
        return '<li><button type="button" class="door' + (d.type ? '' : ' empty') + '" data-day="' + d.day + '"><span class="n">' + d.day + '</span><span class="t"><b>' + esc(d.title || (d.type ? TYPE_LABEL[d.type] : 'Empty')) + '</b><small>' + esc(d.type ? TYPE_LABEL[d.type] : 'Not filled yet') + '</small></span></button></li>';
      }).join('') + '</ul>' +
      '<div class="panel"><h2>Put it on your site</h2><p>Paste this into an HTML block (in WordPress, a Custom HTML block). It resizes itself to fit the page. Your site has to be in EMBED_ORIGINS.</p>' +
        '<textarea class="snippet" id="snippet" readonly aria-label="Embed code">' + esc(embedSnippet(c)) + '</textarea>' +
        '<button class="btn small" type="button" id="copySnippet">Copy embed code</button></div>' +
      (c.demo ? '' : '<div class="panel"><h2>Reminder sign-ups</h2><div id="signups"><p>Loading...</p></div></div>') +
      (c.demo ? '' : '<div class="panel danger"><h2>Delete this calendar</h2><p>Removes the calendar and all 24 of its doors. Any post that embeds it will show an empty spot.</p><br>' +
        '<button class="btn ghost small" type="button" id="askDelete">Delete ' + esc(c.title) + '</button>' +
        '<div class="confirm" id="confirmDelete" hidden><p>Delete "' + esc(c.title) + '" for good? This can\'t be undone.</p><div class="row"><button class="btn red small" type="button" id="yesDelete">Yes, delete it</button><button class="btn ghost small" type="button" id="noDelete">Keep it</button></div></div></div>');
    requestAnimationFrame(function () { $('bar').style.width = Math.round(filled / 24 * 100) + '%'; });
    $('calForm').addEventListener('submit', guard($('saveCal'), saveCalendar));
    $('previewCal').addEventListener('click', guard($('previewCal'), openPreview));
    if (!c.demo) loadSignups(c);
    $('copySnippet').addEventListener('click', function () {
      var t = $('snippet');
      (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(function () { toast('Embed code copied'); }, function () { t.select(); toast('Selected. Press Cmd+C to copy.'); });
    });
    document.querySelectorAll('.door').forEach(function (b) { b.addEventListener('click', function () { openDoor(Number(b.getAttribute('data-day'))); }); });
    if ($('askDelete')) {
      $('askDelete').addEventListener('click', function () { $('confirmDelete').hidden = false; $('askDelete').hidden = true; $('yesDelete').focus(); });
      $('noDelete').addEventListener('click', function () { $('confirmDelete').hidden = true; $('askDelete').hidden = false; $('askDelete').focus(); });
      $('yesDelete').addEventListener('click', guard($('yesDelete'), deleteCalendar));
    }
  }

  function deleteCalendar() {
    var gone = current;
    return api('c/' + encodeURIComponent(gone.slug), { method: 'DELETE' }).then(function () {
      calendars = calendars.filter(function (c) { return c.slug !== gone.slug; });
      current = null; renderTabs();
      if (!calendars.length) { openAdd(true); toast('Deleted ' + gone.title); return; }
      var next = calendars[0].slug;
      // the deleted calendar's screen no longer exists, so it leaves history
      history.replaceState({ view: 'cal', slug: next }, '', location.pathname);
      return openCalendar(next, true).then(function () { toast('Deleted ' + gone.title); });
    }).catch(function (e) { if (e.message !== 'session') toast(e.message); });
  }

  // Email reminder sign-ups. The newsletter list downloads as a CSV for your newsletter
  // tool's import. Only confirmed people who checked the box.
  function peopleHtml(people) {
    if (!people.length) return '<h3 class="people-h">Everyone who signed up</h3><p>Nobody yet.</p>';
    var STATUS = { confirmed: 'Confirmed', pending: 'Not confirmed yet', unsubscribed: 'Stopped' };
    function picked(p) {
      if (p.status === 'pending') return '';
      var out = [];
      if (p.daily) out.push('Daily'); else if (p.launch) out.push('Dec 1 only');
      if (p.newsletter) out.push('Newsletter');
      return out.join(', ');
    }
    return '<h3 class="people-h">Everyone who signed up (' + people.length + ')</h3>' +
      '<div class="people-wrap"><table class="people"><thead><tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Picked</th><th scope="col">Signed up</th></tr></thead><tbody>' +
      people.map(function (p) {
        return '<tr><td>' + esc(p.email) + '</td><td>' + esc(STATUS[p.status] || p.status) + '</td><td>' + esc(picked(p)) + '</td><td>' + esc(p.signed_up ? new Date(p.signed_up).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // The newsletter download holds only people new since the last download,
  // so nobody gets imported twice. "Everyone" is the fallback for a lost file.
  function newsHtml(n, d) {
    if (!n.length) return '<p><strong>0 want the newsletter.</strong> Nobody yet.</p>';
    var fresh = n.filter(function (r) { return r.confirmed_at > (d.last_confirmed_at || 0); }).length;
    var when = d.last_download ? new Date(d.last_download).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return '<p><strong>' + n.length + ' want the newsletter, ' + fresh + ' new' + (when ? ' since your last download on ' + when : '') + '.</strong> ' +
      (fresh ? 'Download the new ones and import them into your newsletter tool.' : 'Nobody new to import.') + '</p>' +
      (fresh ? '<button class="btn small" type="button" id="dlNews">Download ' + fresh + ' new (CSV)</button> ' : '') +
      '<button class="btn small ghost" type="button" id="dlNewsAll">Download everyone (' + n.length + ')</button>';
  }

  function downloadCsv(rows, name) {
    var csv = 'email,signed_up\n' + rows.map(function (r) { return '"' + String(r.email).replace(/"/g, '""') + '",' + new Date(r.confirmed_at).toISOString().slice(0, 10); }).join('\n') + '\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function loadSignups(c) {
    api('c/' + encodeURIComponent(c.slug) + '/signups').then(function (d) {
      if (!current || current.slug !== c.slug || !$('signups')) return;
      var n = d.newsletter || [];
      $('signups').innerHTML =
        '<p><strong>' + d.confirmed + ' confirmed</strong>: ' + d.daily + ' daily, ' + d.launch_only + ' just the Dec 1 email. ' +
        (d.pending ? d.pending + ' waiting to confirm. ' : '') + (d.stopped ? d.stopped + ' stopped. ' : '') + '</p>' +
        '<p>Email reminders across all calendars are capped at ' + d.cap + ' people, so the emails fit Resend\'s free plan. Raise SUB_CAP and EMAIL_DAILY_CAP in src/lib/remind.js together if you move to a bigger plan.</p>' +
        newsHtml(n, d) +
        peopleHtml(d.people || []);
      var b = $('dlNews');
      if (b) b.addEventListener('click', function () {
        var fresh = n.filter(function (r) { return r.confirmed_at > (d.last_confirmed_at || 0); });
        var upto = Math.max.apply(null, fresh.map(function (r) { return r.confirmed_at; }));
        downloadCsv(fresh, c.slug + '-newsletter-new-' + new Date().toISOString().slice(0, 10) + '.csv');
        b.disabled = true;
        api('c/' + encodeURIComponent(c.slug) + '/signups/exported', { method: 'POST', body: { upto: upto } })
          .then(function () { toast('Downloaded ' + fresh.length + ' new. Next time: only people who join after this.'); loadSignups(c); })
          .catch(function (e) { b.disabled = false; if (e.message !== 'session') toast("Downloaded, but I couldn't save the date, so they'll show as new again: " + e.message); });
      });
      var all = $('dlNewsAll');
      if (all) all.addEventListener('click', function () { downloadCsv(n, c.slug + '-newsletter-everyone.csv'); });
    }).catch(function (e) { if ($('signups') && e.message !== 'session') $('signups').innerHTML = '<p>' + esc(e.message) + '</p>'; });
  }

  // Preview links are signed and last 12 hours. Open the tab first (inside the click),
  // then point it at the link, so popup blockers leave it alone.
  function openPreview() {
    var w = window.open('about:blank', '_blank');
    return api('c/' + encodeURIComponent(current.slug) + '/preview', { method: 'POST' }).then(function (d) {
      if (w) { w.opener = null; w.location.href = d.url; } else location.href = d.url;
    }).catch(function (e) { if (w) w.close(); if (e.message !== 'session') toast(e.message); });
  }

  function saveCalendar() {
    var picked = document.querySelector('input[name="c_theme"]:checked');
    var body = { title: $('c_title').value, subtitle: $('c_sub').value, home_url: $('c_home').value.trim(), published: $('c_pub').checked, theme: picked ? picked.value : current.theme };
    return api('c/' + encodeURIComponent(current.slug), { method: 'PUT', body: body }).then(function (d) {
      current = d.calendar;
      calendars = calendars.map(function (c) { return c.slug === current.slug ? current : c; });
      renderTabs(); renderCalendar();
      toast(current.published ? 'Saved. The calendar is live.' : "Saved. Visitors can't see it yet.");
    }).catch(function (e) { if (e.message !== 'session') toast(e.message); });
  }

  function openAdd(fromHistory) {
    $('addLooks').innerHTML = '<legend>Look</legend>' + looksHtml('a_theme', 'workshop');
    $('addMsg').textContent = ''; $('addMsg').className = 'msg';
    show('add', fromHistory ? null : { view: 'add' }, fromHistory);
    $('a_title').focus();
  }
  $('addBack').addEventListener('click', function () { if (history.state && history.state.view === 'add') history.back(); else if (current) openCalendar(current.slug, true); });
  $('addForm').addEventListener('submit', guard($('addBtn'), function () {
    var title = $('a_title').value.trim(), picked = document.querySelector('input[name="a_theme"]:checked');
    var m = $('addMsg');
    if (!title) { m.textContent = 'Give the calendar a name.'; m.className = 'msg bad'; return; }
    m.textContent = 'Adding...'; m.className = 'msg';
    return api('calendars', { method: 'POST', body: { title: title, subtitle: $('a_sub').value, theme: picked ? picked.value : 'workshop' } }).then(function (d) {
      calendars.push(d.calendar); renderTabs();
      $('a_title').value = ''; $('a_sub').value = '';
      current = null;
      // the add form is used up, so it leaves history (Back skips it)
      history.replaceState({ view: 'cal', slug: d.calendar.slug }, '', location.pathname);
      return openCalendar(d.calendar.slug, true).then(function () { toast('Added. It stays hidden until you turn it on.'); });
    }).catch(function (e) { if (e.message !== 'session') { m.textContent = e.message + ' Your name and look are still here.'; m.className = 'msg bad'; } });
  }));

  function draftKey(day) { return 'advdraft:' + current.slug + ':' + day; }
  function openDoor(day, fromHistory) {
    var d = doors.filter(function (x) { return x.day === day; })[0];
    if (!d) return;
    editing = d;
    $('editHead').textContent = 'Door ' + day;
    $('editSub').textContent = current.demo ? 'Demo calendar' : 'Opens December ' + day + ', ' + current.year;
    var draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(draftKey(day)) || 'null'); } catch (e) {}
    FIELDS.forEach(function (f) { $('f_' + f).value = draft && f in draft ? draft[f] : d[f] || ''; });
    msg(draft ? "I kept the changes you hadn't saved yet." : '');
    syncSponsor();
    show('edit', fromHistory ? null : { view: 'door', slug: current.slug, day: day }, fromHistory);
    $('f_type').focus();
  }
  function syncSponsor() {
    var t = $('f_type').value;
    $('sponsorField').hidden = t !== 'sponsored';
    $('playField').hidden = $('playItemsField').hidden = t !== 'play';
    $('ctaHint').hidden = t !== 'download';
    $('ctaLabel').textContent = t === 'download' ? 'File link' : 'Button link';
    if (t === 'play' && !$('f_play').value) $('f_play').value = 'pick';
  }
  $('f_type').addEventListener('change', syncSponsor);
  $('doorForm').addEventListener('input', function () {
    if (!editing) return;
    var v = {}; FIELDS.forEach(function (f) { v[f] = $('f_' + f).value; });
    try { sessionStorage.setItem(draftKey(editing.day), JSON.stringify(v)); } catch (e) {}
  });
  $('editBack').addEventListener('click', function () { if (history.state && history.state.view === 'door') history.back(); else openCalendar(current.slug, true); });
  $('previewDoor').addEventListener('click', guard($('previewDoor'), openPreview));

  $('doorForm').addEventListener('submit', guard($('saveDoor'), function () {
    var body = {}; FIELDS.forEach(function (f) { body[f] = $('f_' + f).value; });
    if (body.type === 'play' && !body.play_items.trim()) return msg('Add at least one game item, one per line.', 'bad');
    if (body.type === 'download' && !body.cta_url.trim()) return msg('Add the link to the file people will download.', 'bad');
    if (body.type !== 'play') { body.play = ''; }
    if (body.type === 'sponsored' && !body.sponsor.trim()) return msg("Add the brand name so the door can say who it's from.", 'bad');
    if (body.image_url && !body.image_alt.trim()) return msg("Add a short description of the picture for people who can't see it.", 'bad');
    msg('Saving...');
    var day = editing.day;
    return api('c/' + encodeURIComponent(current.slug) + '/doors/' + day, { method: 'PUT', body: body }).then(function (d) {
      doors = doors.map(function (x) { return x.day === day ? d.door : x; });
      editing = d.door;
      try { sessionStorage.removeItem(draftKey(day)); } catch (e) {}
      msg('Saved.', 'ok'); toast('Door ' + day + ' saved');
    }).catch(function (e) { if (e.message !== 'session') msg(e.message + ' Your changes are still here.', 'bad'); });
  }));

  // Login: the token lives in this tab only (sessionStorage) and is sent as a header.
  function askForToken(why) {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    token = '';
    $('dashView').hidden = $('editView').hidden = $('addView').hidden = true;
    $('loginView').hidden = false;
    $('loginMsg').textContent = why || '';
    $('loginToken').value = '';
    $('loginToken').focus();
  }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('loginToken').value.trim();
    if (t.length < 32) { $('loginMsg').textContent = 'The admin token is at least 32 characters. Check what you set with wrangler secret put ADMIN_API_TOKEN.'; return; }
    token = t;
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch (x) {}
    $('loginView').hidden = true;
    boot();
  });
  $('signOut').addEventListener('click', function () { askForToken('Signed out.'); });

  function boot() {
  $('dashView').hidden = false;
  api('calendars').then(function (d) {
    calendars = d.calendars;
    renderTabs();
    var st = history.state || {};
    if (!calendars.length) { openAdd(true); return; }
    var slug = st.slug && calendars.some(function (c) { return c.slug === st.slug; }) ? st.slug : calendars[0].slug;
    if (!st.view) history.replaceState({ view: 'cal', slug: slug }, '', location.pathname);
    return openCalendar(slug, true).then(function () { if (st.view === 'door' && st.day) openDoor(st.day, true); });
  }).catch(function (e) {
    if (e.message === 'session') return;
    $('calPanel').innerHTML = '<div class="panel"><p>' + esc(e.message) + '</p><br><button class="btn" type="button" id="retryAll">Try again</button></div>';
    $('retryAll').addEventListener('click', function () { location.reload(); });
  });
  }
  if (token) boot(); else askForToken('');
})();
