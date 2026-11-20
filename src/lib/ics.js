// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// "Add to calendar": one daily reminder, Dec 1-24, at 9:00 in the viewer's own
// time zone. A DTSTART with no TZID is "floating" (RFC 5545 3.3.5), so every
// calendar app shows it at 9:00 local instead of converting from UTC.

function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }

// Lines over 75 octets get folded (RFC 5545 3.1).
function fold(line) {
  const out = []; let rest = line;
  while (new TextEncoder().encode(rest).length > 75) { out.push(rest.slice(0, 70)); rest = ' ' + rest.slice(70); }
  out.push(rest);
  return out.join('\r\n');
}

export function remindersIcs(cal, pageUrl) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Advent Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${cal.slug}-${cal.year}-reminder@${new URL(pageUrl).hostname}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${cal.year}1201T090000`,
    `DTEND:${cal.year}1201T091500`,
    'RRULE:FREQ=DAILY;COUNT=24',
    `SUMMARY:${icsEscape(`Open today's door: ${cal.title}`)}`,
    `DESCRIPTION:${icsEscape(`A new door opened today. ${pageUrl}`)}`,
    `URL:${pageUrl}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape('A new advent door is open')}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
