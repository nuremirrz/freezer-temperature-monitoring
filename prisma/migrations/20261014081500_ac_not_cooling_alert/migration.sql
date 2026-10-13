-- An air conditioner is no longer judged by how hot the room is, but by how much colder the
-- air leaving its duct is. That verdict needs an alert type of its own: "not_cooling" is the
-- unit blowing air that is not cold enough, which is a different fault from a walk-in drifting
-- out of its band, reads differently in Telegram, and must not be mixed into one history.
--
-- Adding a value to an enum is additive: existing rows and queries are untouched.
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'not_cooling';
