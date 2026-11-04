ALTER TABLE organizations ADD COLUMN trial_started_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN trial_ends_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'inactive'
  CHECK (subscription_status IN ('inactive', 'active', 'past_due', 'canceled'));
ALTER TABLE organizations ADD COLUMN paid_until INTEGER NOT NULL DEFAULT 0;

-- Existing businesses receive the full trial from the migration, not their creation date.
UPDATE organizations
SET trial_started_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    trial_ends_at = (CAST(strftime('%s', 'now') AS INTEGER) + 14 * 24 * 60 * 60) * 1000;
