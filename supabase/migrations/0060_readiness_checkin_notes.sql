-- Quick check-in (Home) sends free text through the AI parse-checkin edge
-- function to fill in the structured readiness fields, but the raw wording
-- itself was discarded after parsing. Persisting it lets the coaching engine
-- quote it back in the today-focus summary/insights, instead of only ever
-- acting on the parsed numbers.

alter table public.readiness_checkins
  add column notes text;
