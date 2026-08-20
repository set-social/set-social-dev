-- Milestone 73: normalize exercises.primary_muscle / secondary_muscles onto
-- this app's fixed 13-value taxonomy (MUSCLE_GROUPS in
-- constants/muscleGroups.ts: chest, back, shoulders, biceps, triceps,
-- forearms, core, obliques, quadriceps, hamstrings, glutes, calves,
-- full_body).
--
-- Audit finding: 0034_seed_exercise_library_expansion.sql imported its
-- source CSV's primary_muscle/secondary_muscles values close to verbatim
-- (see that migration's own column-mapping comment) instead of mapping them
-- onto MUSCLE_GROUPS. Both columns are plain `text`/`text[]` with no check
-- constraint (0002_exercises_and_programs.sql, 0014_exercise_substitutions.sql),
-- so nothing caught the mismatch at write time. The result: 427 of 917
-- library exercises (~47%) carried a primary_muscle like 'upper back',
-- 'latissimus dorsi', 'rectus abdominis', or 'anterior deltoids' instead of
-- one of the 13 values — and every consumer that matches primary_muscle
-- against that fixed list (MuscleHeatMap's MUSCLE_TO_SLUGS, the Stats tab's
-- Muscle Heat Map; WeeklyReviewScreen's volume-by-muscle-group list;
-- GenerateProgramScreen's emphasis picker; coachingEngine's substitution
-- matching) silently excluded that exercise's sets entirely rather than
-- misattributing them. A month of nothing but e.g. lat pulldowns
-- ('latissimus dorsi') would show zero back volume, not partial or
-- approximate — the exercise just never matched anything. 769 of 1,909
-- secondary_muscles tags (~40%) had the same problem, understating the
-- half-credit secondary contribution MuscleHeatMap gives (see
-- SECONDARY_MUSCLE_WEIGHT in MuscleHeatMap.tsx) for exercises like squats
-- crediting glutes/hamstrings.
--
-- This is a one-time data fix, not a schema change — primary_muscle stays
-- plain text (a custom exercise's AI classification, or a future taxonomy
-- value, still needs to fit through it unconstrained).
--
-- Exception, by design: category = 'cardio' exercises (treadmill, rowing
-- machine, agility drills, ...) keep a non-canonical primary_muscle
-- ('cardiovascular', normalized below) rather than being forced into one of
-- the 13 strength muscle groups — cardio work has no single dominant
-- muscle group in this app's model, and a fabricated 'full_body' or
-- 'quadriceps' would be a lower-confidence guess than simply not
-- attributing it. (These exercises aren't filtered out of the general
-- exercise picker used for strength logging, so they remain reachable
-- there — nothing about this migration changes that; it just keeps their
-- primary_muscle spelling consistent between the two seed migrations that
-- created them, 0034 and 0040_cardio_day.sql.)

-- ---------------------------------------------------------------------
-- primary_muscle
-- ---------------------------------------------------------------------

update public.exercises set primary_muscle = 'back'
  where primary_muscle in ('upper back', 'latissimus dorsi', 'lower traps', 'middle traps', 'spine', 'thoracic spine');

update public.exercises set primary_muscle = 'shoulders'
  where primary_muscle in ('lateral deltoids', 'anterior deltoids', 'posterior deltoids', 'rotator cuff', 'neck');

update public.exercises set primary_muscle = 'core'
  where primary_muscle in ('rectus abdominis', 'transverse abdominis', 'lower abdominals', 'abdominals');

update public.exercises set primary_muscle = 'chest'
  where primary_muscle = 'serratus anterior';

update public.exercises set primary_muscle = 'glutes'
  where primary_muscle = 'gluteus medius';

update public.exercises set primary_muscle = 'quadriceps'
  where primary_muscle in ('adductors', 'hip flexors');

update public.exercises set primary_muscle = 'calves'
  where primary_muscle in ('ankles', 'foot intrinsics');

update public.exercises set primary_muscle = 'forearms'
  where primary_muscle = 'grip';

-- 'hips' (2 rows) needs a per-exercise call, not a blanket one — a hip
-- rotation stretch and a squat-bottom mobility hold don't share one target.
update public.exercises set primary_muscle = 'glutes'
  where name = '90/90 Hip Stretch' and primary_muscle = 'hips';
update public.exercises set primary_muscle = 'quadriceps'
  where name = 'Deep Squat Hold' and primary_muscle = 'hips';

-- 'full body' (space) was the CSV's literal text, not this table's actual
-- 'full_body' value. Of the 71 rows, 18 are conditioning/agility drills
-- already filed under category = 'cardio' (A-Skip, Shuttle Run, ...) — those
-- go to 'cardiovascular' instead, matching every other cardio-category
-- exercise, rather than being called a strength full_body movement.
update public.exercises set primary_muscle = 'cardiovascular'
  where primary_muscle = 'full body' and category = 'cardio';
update public.exercises set primary_muscle = 'full_body'
  where primary_muscle = 'full body';

-- Spelling only, for consistency with 0040_cardio_day.sql's 8 rows.
update public.exercises set primary_muscle = 'cardiovascular'
  where primary_muscle = 'cardiovascular system';

-- ---------------------------------------------------------------------
-- secondary_muscles — same taxonomy, applied per array element. Anything
-- with no single defensible muscle-group target ('balance', 'full body',
-- 'legs', 'stabilizers' — a training quality or an unspecified region, not
-- a muscle) is dropped rather than guessed, same principle the
-- classify-exercise-muscle AI prompt uses for 'full_body' as a primary
-- muscle ("not a default for anything merely ambiguous").
-- ---------------------------------------------------------------------

with secondary_muscle_map(from_term, to_term) as (
  values
    ('anterior deltoids', 'shoulders'),
    ('posterior deltoids', 'shoulders'),
    ('brachialis', 'biceps'),
    ('gastrocnemius', 'calves'),
    ('soleus', 'calves'),
    ('grip', 'forearms'),
    ('hip flexors', 'quadriceps'),
    ('latissimus dorsi', 'back'),
    ('lower back', 'back'),
    ('teres major', 'back'),
    ('traps', 'back'),
    ('upper back', 'back'),
    ('upper traps', 'back'),
    ('upper chest', 'chest')
)
update public.exercises e
set secondary_muscles = (
  select coalesce(array_agg(distinct mapped.value), '{}')
  from (
    select coalesce(m.to_term, s.term) as value
    from unnest(e.secondary_muscles) as s(term)
    left join secondary_muscle_map m on m.from_term = s.term
    where s.term not in ('balance', 'full body', 'legs', 'stabilizers')
  ) mapped
)
where secondary_muscles && array[
  'anterior deltoids', 'posterior deltoids', 'brachialis', 'gastrocnemius', 'soleus',
  'grip', 'hip flexors', 'latissimus dorsi', 'lower back', 'teres major', 'traps',
  'upper back', 'upper traps', 'upper chest', 'balance', 'full body', 'legs', 'stabilizers'
];
