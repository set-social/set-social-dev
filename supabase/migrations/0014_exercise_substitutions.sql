-- Milestone 14: exercise metadata for substitution matching, plus a log of
-- substitution decisions (same "store the decision" contract as 0012/0013).
--
-- No new multi-location "gym profile" system here on purpose — profiles.equipment_access
-- already is a single, user-editable equipment set (onboarding + Settings), and this
-- pass builds substitution matching on top of it rather than a parallel one.

create type public.movement_pattern as enum (
  'squat',
  'hinge',
  'lunge',
  'push_horizontal',
  'push_vertical',
  'pull_horizontal',
  'pull_vertical',
  'carry',
  'rotation',
  'isolation',
  'core',
  'cardio'
);

create type public.exercise_difficulty as enum ('beginner', 'intermediate', 'advanced');

-- Reused for both joint_stress and skill_requirement — same three-point scale,
-- different question ("how hard on the joints" vs "how technical").
create type public.stress_level as enum ('low', 'moderate', 'high');

create type public.substitution_scope as enum ('workout_only', 'permanent');

alter table public.exercises
  add column movement_pattern public.movement_pattern,
  add column secondary_muscles text[] not null default '{}',
  add column difficulty public.exercise_difficulty,
  add column joint_stress public.stress_level,
  add column skill_requirement public.stress_level;

-- ---------------------------------------------------------------------------
-- Backfill for every row seeded in 0003_seed_exercises.sql, matched by name.
-- New custom exercises a user creates later are unaffected (columns stay
-- null — the coaching engine treats null metadata as "unknown," not "none,"
-- same handling as every other optional signal in this app).
-- ---------------------------------------------------------------------------

update public.exercises set movement_pattern = 'squat', secondary_muscles = '{glutes,hamstrings}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Barbell Back Squat';
update public.exercises set movement_pattern = 'squat', secondary_muscles = '{quadriceps,core}', difficulty = 'advanced', joint_stress = 'moderate', skill_requirement = 'high' where name = 'Barbell Front Squat';
update public.exercises set movement_pattern = 'hinge', secondary_muscles = '{glutes,back,core}', difficulty = 'advanced', joint_stress = 'high', skill_requirement = 'high' where name = 'Barbell Deadlift';
update public.exercises set movement_pattern = 'hinge', secondary_muscles = '{glutes,back}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Romanian Deadlift';
update public.exercises set movement_pattern = 'push_horizontal', secondary_muscles = '{triceps,shoulders}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Barbell Bench Press';
update public.exercises set movement_pattern = 'push_horizontal', secondary_muscles = '{shoulders,triceps}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Incline Barbell Bench Press';
update public.exercises set movement_pattern = 'push_vertical', secondary_muscles = '{triceps,core}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Overhead Press';
update public.exercises set movement_pattern = 'pull_horizontal', secondary_muscles = '{biceps,shoulders}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Barbell Row';
update public.exercises set movement_pattern = 'pull_horizontal', secondary_muscles = '{biceps,shoulders}', difficulty = 'advanced', joint_stress = 'moderate', skill_requirement = 'high' where name = 'Pendlay Row';
update public.exercises set movement_pattern = 'hinge', secondary_muscles = '{hamstrings,core}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Barbell Hip Thrust';
update public.exercises set movement_pattern = 'lunge', secondary_muscles = '{glutes,hamstrings}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Barbell Lunge';
update public.exercises set movement_pattern = 'hinge', secondary_muscles = '{hamstrings}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Barbell Hip Thrust Belt';
update public.exercises set movement_pattern = 'hinge', secondary_muscles = '{hamstrings,quadriceps,back}', difficulty = 'advanced', joint_stress = 'high', skill_requirement = 'high' where name = 'Sumo Deadlift';
update public.exercises set movement_pattern = 'push_horizontal', secondary_muscles = '{chest,shoulders}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Close-Grip Bench Press';
update public.exercises set movement_pattern = 'push_horizontal', secondary_muscles = '{triceps,shoulders}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Bench Press';
update public.exercises set movement_pattern = 'push_horizontal', secondary_muscles = '{shoulders,triceps}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Incline Press';
update public.exercises set movement_pattern = 'push_vertical', secondary_muscles = '{triceps}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Shoulder Press';
update public.exercises set movement_pattern = 'pull_horizontal', secondary_muscles = '{biceps,shoulders}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Row';
update public.exercises set movement_pattern = 'hinge', secondary_muscles = '{glutes,back}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Romanian Deadlift';
update public.exercises set movement_pattern = 'squat', secondary_muscles = '{glutes,core}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Goblet Squat';
update public.exercises set movement_pattern = 'lunge', secondary_muscles = '{glutes,hamstrings}', difficulty = 'advanced', joint_stress = 'moderate', skill_requirement = 'high' where name = 'Dumbbell Bulgarian Split Squat';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Lateral Raise';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{back}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Rear Delt Fly';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Bicep Curl';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{forearms}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Hammer Curl';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Dumbbell Skull Crusher';
update public.exercises set movement_pattern = 'lunge', secondary_muscles = '{glutes,hamstrings}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Dumbbell Step-Up';
update public.exercises set movement_pattern = 'carry', secondary_muscles = '{core,back}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Dumbbell Farmer Carry';
update public.exercises set movement_pattern = 'pull_vertical', secondary_muscles = '{biceps}', difficulty = 'advanced', joint_stress = 'low', skill_requirement = 'high' where name = 'Pull-Up';
update public.exercises set movement_pattern = 'pull_vertical', secondary_muscles = '{back}', difficulty = 'advanced', joint_stress = 'low', skill_requirement = 'high' where name = 'Chin-Up';
update public.exercises set movement_pattern = 'push_horizontal', secondary_muscles = '{triceps,shoulders,core}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Push-Up';
update public.exercises set movement_pattern = 'push_vertical', secondary_muscles = '{chest,shoulders}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Dip';
update public.exercises set movement_pattern = 'squat', secondary_muscles = '{glutes}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Bodyweight Squat';
update public.exercises set movement_pattern = 'lunge', secondary_muscles = '{glutes,hamstrings}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Walking Lunge';
update public.exercises set movement_pattern = 'hinge', secondary_muscles = '{hamstrings}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Glute Bridge';
update public.exercises set movement_pattern = 'core', secondary_muscles = '{shoulders}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Plank';
update public.exercises set movement_pattern = 'core', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Side Plank';
update public.exercises set movement_pattern = 'core', secondary_muscles = '{forearms}', difficulty = 'advanced', joint_stress = 'low', skill_requirement = 'high' where name = 'Hanging Leg Raise';
update public.exercises set movement_pattern = 'core', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Sit-Up';
update public.exercises set movement_pattern = 'cardio', secondary_muscles = '{core}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Mountain Climber';
update public.exercises set movement_pattern = 'cardio', secondary_muscles = '{chest,quadriceps}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Burpee';
update public.exercises set movement_pattern = 'cardio', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Jumping Jack';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Bodyweight Calf Raise';
update public.exercises set movement_pattern = 'pull_vertical', secondary_muscles = '{biceps}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Lat Pulldown';
update public.exercises set movement_pattern = 'pull_horizontal', secondary_muscles = '{biceps,shoulders}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Seated Cable Row';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Cable Tricep Pushdown';
update public.exercises set movement_pattern = 'pull_horizontal', secondary_muscles = '{back}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Cable Face Pull';
update public.exercises set movement_pattern = 'rotation', secondary_muscles = '{core}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Cable Woodchopper';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{shoulders}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Cable Chest Fly';
update public.exercises set movement_pattern = 'squat', secondary_muscles = '{glutes,hamstrings}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Leg Press';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Leg Extension';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Leg Curl';
update public.exercises set movement_pattern = 'push_horizontal', secondary_muscles = '{triceps,shoulders}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Chest Press Machine';
update public.exercises set movement_pattern = 'push_vertical', secondary_muscles = '{triceps}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Shoulder Press Machine';
update public.exercises set movement_pattern = 'pull_horizontal', secondary_muscles = '{biceps}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Seated Row Machine';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Calf Raise Machine';
update public.exercises set movement_pattern = 'hinge', secondary_muscles = '{core,back}', difficulty = 'intermediate', joint_stress = 'moderate', skill_requirement = 'moderate' where name = 'Kettlebell Swing';
update public.exercises set movement_pattern = 'squat', secondary_muscles = '{glutes,core}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Kettlebell Goblet Squat';
update public.exercises set movement_pattern = 'rotation', secondary_muscles = '{core,shoulders}', difficulty = 'advanced', joint_stress = 'moderate', skill_requirement = 'high' where name = 'Kettlebell Turkish Get-Up';
update public.exercises set movement_pattern = 'isolation', secondary_muscles = '{back}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Band Pull-Apart';
update public.exercises set movement_pattern = 'pull_horizontal', secondary_muscles = '{back}', difficulty = 'beginner', joint_stress = 'low', skill_requirement = 'low' where name = 'Band Face Pull';

-- ---------------------------------------------------------------------------
-- exercise_substitutions: one row per proposed/decided swap.
-- ---------------------------------------------------------------------------

create table public.exercise_substitutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  workout_log_id uuid references public.workout_logs (id) on delete cascade,
  original_exercise_id uuid not null references public.exercises (id),
  substitute_exercise_id uuid not null references public.exercises (id),
  reason text not null,
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  scope public.substitution_scope not null,
  created_at timestamptz not null default now()
);

create index exercise_substitutions_user_id_idx on public.exercise_substitutions (user_id);
create index exercise_substitutions_workout_log_id_idx on public.exercise_substitutions (workout_log_id);

alter table public.exercise_substitutions enable row level security;

create policy "exercise_substitutions_all_own"
  on public.exercise_substitutions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
