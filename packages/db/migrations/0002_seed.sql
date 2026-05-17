-- Seed the three launch subjects. Idempotent on slug.
INSERT INTO subjects (slug, name, description, color_hex, icon_slug) VALUES
  ('history',    'History',    'Civilizations, eras, primary sources, and causation.',  '#FF6B6B', 'scroll'),
  ('economics',  'Economics',  'Micro and macro, markets, policy, and decision theory.', '#4ECDC4', 'coins'),
  ('philosophy', 'Philosophy', 'Logic, ethics, metaphysics, argument and inquiry.',      '#9B59B6', 'feather')
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  color_hex   = EXCLUDED.color_hex,
  icon_slug   = EXCLUDED.icon_slug;

-- A handful of starter achievements. The full set comes online with the gamification slice.
INSERT INTO achievements (slug, name, description, icon_slug, category, criteria, xp_reward) VALUES
  ('first_quest',     'First Steps',       'Start your first quest.',                    'compass',  'progress', '{"event":"quest_started","count":1}'::jsonb, 50),
  ('first_chat',      'Hello, Tutor',      'Send your first message to the tutor.',      'speech',   'progress', '{"event":"message_sent","count":1}'::jsonb,  25),
  ('first_node_done', 'One Step Closer',   'Master your first skill node.',              'check',    'mastery',  '{"event":"node_mastered","count":1}'::jsonb, 100),
  ('three_day_streak','Habit Forming',     'Study three days in a row.',                 'flame',    'streak',   '{"event":"streak_days","count":3}'::jsonb,   75)
ON CONFLICT (slug) DO NOTHING;
