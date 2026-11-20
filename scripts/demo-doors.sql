-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
-- Sample doors for the public demo calendar (/c/demo). Every door is marked
-- "sample" on the page. Codes are obviously fake. Re-run to reset the demo:
--   npx wrangler d1 execute advent-calendar-db --remote --file=scripts/demo-doors.sql
-- (use --local instead of --remote for your local copy)
DELETE FROM doors WHERE calendar_slug = 'demo';
INSERT INTO doors (calendar_slug, day, type, title, blurb, code, code_note) VALUES
('demo', 1, 'tool', 'A free tool to start', 'Door 1 is small on purpose. It''s a free little tool you can use today, no signup.', '', ''),
('demo', 2, 'gift', 'A gift pick under $20', 'Something I tested and would happily wrap for a friend.', '', ''),
('demo', 3, 'tip', 'A tip you can use today', 'One thing that saved me time this year, in two sentences.', '', ''),
('demo', 4, 'tool', 'Another free tool', 'A different free tool every few days keeps it fun.', '', ''),
('demo', 5, 'code', '10% off for one day', 'Codes behind a door only work on that door''s day. That''s the reason to come back every morning.', 'SAMPLE10', 'Sample code. It doesn''t work anywhere.'),
('demo', 6, 'deal', 'A deal on something I reviewed', 'Each deal links to my review, so you can read it before you buy.', '', ''),
('demo', 7, 'surprise', 'A surprise', 'Some doors are just for fun.', '', ''),
('demo', 8, 'gift', 'A stocking stuffer', 'Small, useful, and it fits in a stocking.', '', ''),
('demo', 9, 'unlock', 'A bonus inside an app', 'Some doors add something extra inside an app you already use.', '', ''),
('demo', 10, 'tool', 'A free tool for the holidays', 'Timed for the busy week. Use it, close it, move on.', '', ''),
('demo', 11, 'code', '15% off for one day', 'The codes get a little bigger as the month goes on.', 'SAMPLE15', 'Sample code. It doesn''t work anywhere.'),
('demo', 12, 'deal', 'A deal worth waiting for', 'Saved for the middle of the month on purpose.', '', ''),
('demo', 13, 'gift', 'A gift for the person who has everything', 'I tested it so you don''t have to guess.', '', ''),
('demo', 14, 'sponsored', 'A door from a brand', 'Brand doors are always marked as ads, right at the top.', '', ''),
('demo', 15, 'tool', 'A free planner', 'A free tool that helps with the rest of the month.', '', ''),
('demo', 16, 'code', '20% off for one day', 'Bigger again. You can see where this is going.', 'SAMPLE20', 'Sample code. It doesn''t work anywhere.'),
('demo', 17, 'unlock', 'A bigger app bonus', 'The second half of the month is where the good stuff lives.', '', ''),
('demo', 18, 'deal', 'The best deal so far', 'Each door from here on is worth a little more than the one before.', '', ''),
('demo', 19, 'gift', 'A splurge gift pick', 'The one I''d buy for myself.', '', ''),
('demo', 20, 'code', '30% off for one day', 'Almost there.', 'SAMPLE30', 'Sample code. It doesn''t work anywhere.'),
('demo', 21, 'tool', 'A tool I saved for last week', 'One of my favorites, held back for the end of the month.', '', ''),
('demo', 22, 'unlock', 'The biggest app bonus', 'The best extra I could put behind a door.', '', ''),
('demo', 23, 'code', '40% off for one day', 'Door 23 is the warm-up for tomorrow.', 'SAMPLE40', 'Sample code. It doesn''t work anywhere.'),
('demo', 24, 'surprise', 'The big one', 'Door 24 gets the best offer of the whole calendar. That''s the whole idea: the doors get better the closer you get to the end.', '', '');
UPDATE doors SET sponsor = 'A brand you know', updated_at = 0 WHERE calendar_slug = 'demo' AND day = 14;
-- Download + Play samples (added 2026-10-28)
UPDATE doors SET type = 'play', play = 'pick', title = 'Pull a card', blurb = 'Draw one small thing to do today. Draw again if it doesn''t fit.', play_items = 'Text a friend you miss
Take a 10 minute walk with no phone
Write down one thing that went right
Make the bed, then sit for a minute
Drink a glass of water before your coffee
Put on one song and dance badly
Thank someone for something small
Clear one surface in your home' WHERE calendar_slug = 'demo' AND day = 3;
UPDATE doors SET type = 'play', play = 'scratch', title = 'Scratch for a fortune', blurb = 'Scratch the gold paper off to find your fortune for next year.', play_items = 'Next year, the thing you keep putting off takes 20 minutes
Someone is about to make you laugh at the worst moment
You''ll find money in a coat pocket
A plan you gave up on comes back better
You''ll finally finish that one tab you keep open' WHERE calendar_slug = 'demo' AND day = 7;
UPDATE doors SET type = 'download', title = 'A Sock phone wallpaper', blurb = 'A lock screen with the Sock, stuffed full. Save it to your phone.', cta_url = '/doors/demo/sock-wallpaper.png', cta_label = 'Download the wallpaper' WHERE calendar_slug = 'demo' AND day = 10;
UPDATE doors SET type = 'play', play = 'spin', title = 'Spin for a 5 minute task', blurb = 'Spin the wheel and do whatever it lands on. Five minutes, then you''re done.', play_items = 'Cancel one subscription
Pay one bill early
Shred one pile of mail
Back up your phone photos
Check one warranty date
Update one password
Unsubscribe from 3 emails
Find your car title' WHERE calendar_slug = 'demo' AND day = 13;
