// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// Copyright year, computed in the browser so it never goes stale.
document.querySelectorAll('.yr').forEach(function (e) { e.textContent = new Date().getFullYear(); });
