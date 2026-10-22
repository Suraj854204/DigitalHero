-- DEMO DATA ONLY. Fictional organisations, flagged is_demo = true; the UI shows a "Demo" badge.
-- Run with: supabase db reset  (applies migrations + this seed) or paste into the SQL editor.
-- Demo USERS are created by `npm run seed` (needs the Auth admin API), never by SQL.
insert into public.charities (slug, name, short_description, description, category, location, is_featured, is_demo) values
 ('demo-bright-start-learning', 'Demo: Bright Start Learning', 'A fictional charity funding school supplies and tutoring for first-generation learners.', 'Fictional demonstration organisation. Real profiles are written and approved by administrators and contain only verified information.', 'Education', 'Pune, India', true, true),
 ('demo-clear-water-collective', 'Demo: Clear Water Collective', 'A fictional charity imagining safe drinking water for rural clinics.', 'Fictional demonstration organisation.', 'Health', 'Jaipur, India', false, true),
 ('demo-restore-the-river', 'Demo: Restore the River', 'A fictional charity restoring riverbank habitats with local volunteers.', 'Fictional demonstration organisation.', 'Environment', 'Guwahati, India', false, true),
 ('demo-open-door-meals', 'Demo: Open Door Meals', 'A fictional community kitchen that serves a hot meal to anyone who walks in.', 'Fictional demonstration organisation.', 'Community', 'Chennai, India', false, true),
 ('demo-second-chance-strays', 'Demo: Second Chance Strays', 'A fictional shelter that vaccinates, rehomes and rehabilitates street animals.', 'Fictional demonstration organisation.', 'Animal welfare', 'Bengaluru, India', false, true),
 ('demo-play-forward-youth', 'Demo: Play Forward Youth', 'A fictional programme that opens up sport and mentoring to teenagers.', 'Fictional demonstration organisation.', 'Youth', 'Kolkata, India', false, true)
on conflict (slug) do nothing;
