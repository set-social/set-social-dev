-- Milestone 3: seed one sample 4-week/3-day program for manual UI testing,
-- so Today/Calendar have real data before AI generation exists (Milestone 5).
-- Requires 0002 (schema) and 0003 (exercise seed) to have already been run.

do $$
declare
  v_user_id uuid;
  v_program_id uuid;
  v_week_id uuid;
  v_day_id uuid;
  v_week int;
  v_sets int;
begin
  select id into v_user_id from auth.users where email = 'mj.sch89@gmail.com';

  if v_user_id is null then
    raise exception 'No auth.users row found for mj.sch89@gmail.com';
  end if;

  insert into public.programs (user_id, title, goal, source, status, start_date, weeks_count, days_per_week)
  values (v_user_id, 'GymBee Starter Strength', 'strength', 'manual', 'active', current_date, 4, 3)
  returning id into v_program_id;

  for v_week in 1..4 loop
    v_sets := case when v_week = 4 then 2 else 4 end; -- week 4 is a deload

    insert into public.program_weeks (program_id, week_number, focus, deload)
    values (v_program_id, v_week, case when v_week = 4 then 'Deload' else 'Foundation' end, v_week = 4)
    returning id into v_week_id;

    -- Sunday: rest
    insert into public.program_days (program_week_id, day_number, day_of_week, title, is_rest_day)
    values (v_week_id, 1, 0, 'Rest', true);

    -- Monday: Push
    insert into public.program_days (program_week_id, day_number, day_of_week, title, is_rest_day)
    values (v_week_id, 2, 1, 'Push Day', false)
    returning id into v_day_id;

    insert into public.program_exercises
      (program_day_id, exercise_id, order_index, target_sets, target_reps_min, target_reps_max, target_rpe, rest_seconds)
    values
      (v_day_id, (select id from public.exercises where name = 'Barbell Bench Press'), 1, v_sets, 5, 8, 7.5, 150),
      (v_day_id, (select id from public.exercises where name = 'Overhead Press'), 2, v_sets, 6, 10, 7, 120),
      (v_day_id, (select id from public.exercises where name = 'Dumbbell Incline Press'), 3, v_sets - 1, 8, 12, 8, 90),
      (v_day_id, (select id from public.exercises where name = 'Cable Tricep Pushdown'), 4, v_sets - 1, 10, 15, 8, 60);

    -- Tuesday: rest
    insert into public.program_days (program_week_id, day_number, day_of_week, title, is_rest_day)
    values (v_week_id, 3, 2, 'Rest', true);

    -- Wednesday: Pull
    insert into public.program_days (program_week_id, day_number, day_of_week, title, is_rest_day)
    values (v_week_id, 4, 3, 'Pull Day', false)
    returning id into v_day_id;

    insert into public.program_exercises
      (program_day_id, exercise_id, order_index, target_sets, target_reps_min, target_reps_max, target_rpe, rest_seconds)
    values
      (v_day_id, (select id from public.exercises where name = 'Barbell Deadlift'), 1, v_sets - 1, 3, 6, 8, 180),
      (v_day_id, (select id from public.exercises where name = 'Barbell Row'), 2, v_sets, 6, 10, 7.5, 120),
      (v_day_id, (select id from public.exercises where name = 'Lat Pulldown'), 3, v_sets, 8, 12, 8, 90),
      (v_day_id, (select id from public.exercises where name = 'Dumbbell Bicep Curl'), 4, v_sets - 1, 10, 15, 8, 60);

    -- Thursday: rest
    insert into public.program_days (program_week_id, day_number, day_of_week, title, is_rest_day)
    values (v_week_id, 5, 4, 'Rest', true);

    -- Friday: Legs
    insert into public.program_days (program_week_id, day_number, day_of_week, title, is_rest_day)
    values (v_week_id, 6, 5, 'Legs Day', false)
    returning id into v_day_id;

    insert into public.program_exercises
      (program_day_id, exercise_id, order_index, target_sets, target_reps_min, target_reps_max, target_rpe, rest_seconds)
    values
      (v_day_id, (select id from public.exercises where name = 'Barbell Back Squat'), 1, v_sets, 5, 8, 7.5, 180),
      (v_day_id, (select id from public.exercises where name = 'Romanian Deadlift'), 2, v_sets, 6, 10, 7.5, 120),
      (v_day_id, (select id from public.exercises where name = 'Leg Press'), 3, v_sets, 8, 12, 8, 90),
      (v_day_id, (select id from public.exercises where name = 'Bodyweight Calf Raise'), 4, v_sets - 1, 12, 20, 8, 60);

    -- Saturday: rest
    insert into public.program_days (program_week_id, day_number, day_of_week, title, is_rest_day)
    values (v_week_id, 7, 6, 'Rest', true);
  end loop;
end $$;
