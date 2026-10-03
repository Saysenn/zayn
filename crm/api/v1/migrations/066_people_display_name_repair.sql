-- ***************************************************
-- * A profile's first edit wrote the slug as the name
-- ***************************************************
--
-- `people.repo.upsert` defaulted display_name to person_id, so one rate
-- edit showed "gloria-difference" where the sheet says "Gloria difference".
-- Only a name EQUAL to the slug is touched: that is the default, never a choice.

UPDATE tb_people p
   SET display_name = d.person_name,
       updated_at   = now()
  FROM (SELECT DISTINCT ON (person_id) person_id, person_name
          FROM tb_mastersheet
         WHERE btrim(COALESCE(person_name, '')) <> ''
         ORDER BY person_id, id) d
 WHERE d.person_id = p.person_id
   AND p.display_name = p.person_id
   AND d.person_name <> p.display_name;
