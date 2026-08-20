import csv
import os
import sys

# One-off generator for 0034_seed_exercise_library_expansion.sql, kept here
# (not shipped in the app) so the CSV -> SQL mapping rules are reproducible/
# auditable rather than a black-box data dump. Re-running it regenerates the
# exact same migration; it's not part of any build or runtime path.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(SCRIPT_DIR, "SoSet_Comprehensive_Exercise_Library.csv")
OUT_PATH = os.path.join(SCRIPT_DIR, "..", "migrations", "0034_seed_exercise_library_expansion.sql")

EXISTING_NAMES_LOWER = {
    "band pull-apart", "barbell bench press", "barbell hip thrust", "barbell row",
    "burpee", "chin-up", "dumbbell bench press", "dumbbell bulgarian split squat",
    "dumbbell romanian deadlift", "dumbbell row", "dumbbell step-up", "glute bridge",
    "hanging leg raise", "incline barbell bench press", "jumping jack",
    "kettlebell goblet squat", "kettlebell swing", "kettlebell turkish get-up",
    "leg press", "mountain climber", "pendlay row", "plank", "pull-up", "push-up",
    "romanian deadlift", "seated cable row", "side plank", "sit-up", "sumo deadlift",
    "walking lunge",
}

CATEGORY_MAP = {
    # (muscle_group) -> category, independent of force
    "Cardio": "cardio",
    "Conditioning": "cardio",
    "Mobility": "mobility",
    "Prehab": "mobility",
    "Core": "core",
    "Full Body": "full_body",
    "Legs": "legs",
    "Lower Legs": "legs",
    "Glutes": "legs",
    "Posterior Chain": "pull",  # matches existing seed's deadlift-family convention
}
# muscle groups where push vs pull actually matters, resolved via `force`
FORCE_SPLIT_GROUPS = {"Arms", "Back", "Chest", "Shoulders", "Forearms"}

def map_category(muscle_group: str, force: str) -> str:
    if muscle_group in FORCE_SPLIT_GROUPS:
        if force == "Push":
            return "push"
        if force == "Pull":
            return "pull"
        raise ValueError(f"unexpected force {force!r} for muscle_group {muscle_group!r}")
    if muscle_group in CATEGORY_MAP:
        return CATEGORY_MAP[muscle_group]
    raise ValueError(f"unmapped muscle_group {muscle_group!r}")

EQUIPMENT_MAP = {
    "Barbell": "barbell", "EZ-Bar": "barbell", "Safety Squat Bar": "barbell", "Trap Bar": "barbell",
    "T-Bar": "barbell",
    "Dumbbell": "dumbbell", "Dumbbells": "dumbbell",
    "Cable": "cable",
    "Machine": "machine", "Smith Machine": "machine", "Belt Squat Machine": "machine",
    "Pec Deck": "machine", "Plate-Loaded Machine": "machine",
    "Kettlebell": "kettlebell",
    "Resistance Band": "band", "Resistance Band|Pull-Up Bar": "band",
    "Bodyweight": "bodyweight", "None": "bodyweight", "Pull-Up Bar": "bodyweight",
    "Pull-Up Bar|Towel": "bodyweight", "Rings": "bodyweight", "Suspension Trainer": "bodyweight",
}
# everything else -> 'other' (cardio machines, odd implements: sleds, sandbags, medicine balls, ...)

MOVEMENT_PATTERN_MAP = {
    "Squat": "squat",
    "Hinge": "hinge", "Hip Extension": "hinge",
    "Lunge": "lunge",
    "Horizontal Push": "push_horizontal",
    "Vertical Push": "push_vertical",
    "Horizontal Pull": "pull_horizontal",
    "Vertical Pull": "pull_vertical",
    "Carry": "carry",
    "Core Rotation": "rotation", "Core Anti-Rotation": "rotation",
    "Core Anti-Extension": "core", "Core Anti-Lateral Flexion": "core",
    "Core Dynamic Core": "core", "Core Hip Flexion": "core", "Core Spinal Flexion": "core",
    "Cardio": "cardio", "Locomotion": "cardio",
    "Elbow Flexion": "isolation", "Elbow Extension": "isolation",
    "Knee Extension": "isolation", "Knee Flexion": "isolation",
    "Shoulder Flexion": "isolation", "Shoulder Abduction": "isolation",
    "Hip Abduction": "isolation", "Hip Adduction": "isolation",
    "Wrist Flexion": "isolation", "Wrist Extension": "isolation",
    "Dorsiflexion": "isolation", "Plantar Flexion": "isolation",
    "Horizontal Abduction": "isolation", "Horizontal Adduction": "isolation",
    "Grip": "isolation",
    # Deliberately left unmapped (None) -- too ambiguous to guess confidently:
    # 'Functional', 'Mobility', 'Olympic Lift', 'Power', 'Stability'
}

DIFFICULTY_MAP = {"Beginner": "beginner", "Intermediate": "intermediate", "Advanced": "advanced"}


def sql_str(value):
    if value is None:
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def sql_text_array(values):
    if not values:
        return "'{}'"
    # Postgres array literal syntax requires double-quoting any element that
    # contains whitespace, a comma, a brace, or a double quote (e.g. "upper
    # traps") -- unquoted, that would either misparse or silently split on
    # the space. Always double-quote for safety; \\ and \" are the literal's
    # own escapes (applied before the outer SQL string's '' escaping).
    quoted = []
    for v in values:
        inner = v.replace("\\", "\\\\").replace('"', '\\"')
        quoted.append('"' + inner + '"')
    array_body = ",".join(quoted).replace("'", "''")
    return "'{" + array_body + "}'"


def main():
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    skipped_existing = []
    value_lines = []
    unmapped_equipment = set()

    for r in rows:
        name = r["exercise_name"].strip()
        if name.lower() in EXISTING_NAMES_LOWER:
            skipped_existing.append(name)
            continue

        category = map_category(r["muscle_group"].strip(), r["force"].strip())
        primary_muscle = r["primary_muscle"].strip().lower()
        secondary = [m.strip().lower() for m in r["secondary_muscles"].split("|") if m.strip()]
        equipment_raw = r["equipment"].strip()
        equipment = EQUIPMENT_MAP.get(equipment_raw)
        if equipment is None:
            unmapped_equipment.add(equipment_raw)
            equipment = "other"
        movement_pattern = MOVEMENT_PATTERN_MAP.get(r["movement_pattern"].strip())
        difficulty = DIFFICULTY_MAP.get(r["difficulty"].strip())
        tracking_type = r["tracking_type"].strip()
        is_bodyweight = r["bodyweight"].strip().lower() == "true"
        if tracking_type in ("time", "duration"):
            default_metric = "time"
        elif is_bodyweight:
            default_metric = "reps"
        else:
            default_metric = None

        value_lines.append(
            "  ({name}, {category}::public.exercise_category, {primary_muscle}, "
            "{equipment}::public.equipment_type, {secondary}::text[], "
            "{movement_pattern}::public.movement_pattern, {difficulty}::public.exercise_difficulty, "
            "{default_metric})".format(
                name=sql_str(name),
                category=sql_str(category),
                primary_muscle=sql_str(primary_muscle),
                equipment=sql_str(equipment),
                secondary=sql_text_array(secondary),
                movement_pattern=sql_str(movement_pattern),
                difficulty=sql_str(difficulty),
                default_metric=sql_str(default_metric),
            )
        )

    print(f"total csv rows: {len(rows)}", file=sys.stderr)
    print(f"skipped (already seeded): {len(skipped_existing)}", file=sys.stderr)
    print(f"to insert: {len(value_lines)}", file=sys.stderr)
    print(f"equipment values that fell back to 'other': {sorted(unmapped_equipment)}", file=sys.stderr)

    header = """-- Milestone 34: expand the exercise library from the design team's
-- comprehensive CSV (SoSet_Comprehensive_Exercise_Library.csv, 880 rows).
--
-- Column mapping from the source CSV to this table (see the generating
-- script kept alongside this migration's PR for the exact rules):
--   exercise_name          -> name
--   muscle_group + force   -> category (push/pull/legs/core/full_body/cardio/mobility)
--   primary_muscle         -> primary_muscle (lowercased)
--   secondary_muscles      -> secondary_muscles (split on '|', lowercased)
--   equipment               -> equipment (mapped to this table's 8-value enum;
--                              anything not a clean match, e.g. sleds, sandbags,
--                              cardio machines, becomes 'other')
--   movement_pattern        -> movement_pattern (mapped where confident; left
--                              NULL for CSV values too ambiguous to guess --
--                              Functional, Mobility, Olympic Lift, Power, Stability)
--   difficulty              -> difficulty (direct lowercase mapping)
--   tracking_type + bodyweight -> default_metric ('time' for time/duration-tracked,
--                              'reps' for bodyweight/no-load work, NULL otherwise --
--                              NULL means "defer to the logger's kg/lb preference",
--                              same convention 0020_exercise_default_metric.sql set)
--
-- Columns with no source data in the CSV (instructions, demo_media_*,
-- joint_stress, skill_requirement) are left NULL, same as every other
-- library exercise until curated.
--
-- {skipped_count} rows were skipped because a same-named exercise already
-- exists from 0003_seed_exercises.sql (matched case-insensitively) -- see
-- WHERE NOT EXISTS below, which also makes this migration safe to run
-- against a database that already has some overlapping names for any other
-- reason, without needing a global unique constraint on exercises.name (that
-- would also block users from naming a custom exercise the same as a
-- library one, which is out of scope here).

insert into public.exercises (name, category, primary_muscle, equipment, secondary_muscles, movement_pattern, difficulty, default_metric)
select v.name, v.category, v.primary_muscle, v.equipment, v.secondary_muscles, v.movement_pattern, v.difficulty, v.default_metric
from (values
""".format(skipped_count=len(skipped_existing))

    footer = """
) as v(name, category, primary_muscle, equipment, secondary_muscles, movement_pattern, difficulty, default_metric)
where not exists (
  select 1 from public.exercises e where lower(e.name) = lower(v.name)
);
"""

    with open(OUT_PATH, "w") as f:
        f.write(header)
        f.write(",\n".join(value_lines))
        f.write("\n")
        f.write(footer)

    print(f"wrote {OUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
