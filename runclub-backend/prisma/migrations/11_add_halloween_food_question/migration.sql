INSERT INTO "EventQuestion" (id, event_id, prompt, kind, options, required, position, created_at)
SELECT gen_random_uuid(), id, 'Food preference', 'CHOICE', '["Vegetarian","Non-vegetarian","Vegan"]', true, 1, now()
FROM "Event"
WHERE title ILIKE '%halloween%'
ON CONFLICT DO NOTHING;
