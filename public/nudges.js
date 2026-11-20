// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// One small note under each opened door. Edit this list to point people at your own
// things: your newsletter page, your shop, your socials.
// kind: 'remind' (shows the add-to-calendar buttons), 'visit', 'follow' or 'mine'
// ('mine' adds a "My product." label, so readers know it's yours).
// Pools are keyed by calendar look (workshop, plum, jen8n, meadow, arcade), or 'all'.
// A pool with 24 entries gives door N entry N-1. A shorter pool repeats.
// Nudges never show on a Sponsored door or an empty door.
(function () {
  'use strict';
  var REMIND = { kind: 'remind', text: 'Want a nudge when tomorrow\'s door opens?', label: 'Add a daily reminder' };
  // Example of your own link:
  // var SHOP = { kind: 'mine', text: 'Everything I make, in one place.', label: 'See the shop', url: 'https://example.com/shop' };

  window.ADVENT_NUDGES = {
    all: [REMIND]
  };
})();
