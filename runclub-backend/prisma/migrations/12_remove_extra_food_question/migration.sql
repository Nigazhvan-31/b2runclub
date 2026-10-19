-- Delete any answers for the duplicate Food preference question
DELETE FROM "RegistrationAnswer"
WHERE question_id = '5638908c-16e2-40af-8c66-c7262fe20da4'
   OR question_id IN (
     SELECT id FROM "EventQuestion" WHERE prompt = 'Food preference' AND options LIKE '%Vegan%'
   );

-- Delete the duplicate Food preference question
DELETE FROM "EventQuestion"
WHERE id = '5638908c-16e2-40af-8c66-c7262fe20da4'
   OR (prompt = 'Food preference' AND options LIKE '%Vegan%');
