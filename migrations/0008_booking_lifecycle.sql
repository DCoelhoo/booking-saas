ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'completed', 'canceled', 'no_show'));
ALTER TABLE bookings ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN management_token_hash TEXT;
ALTER TABLE bookings ADD COLUMN management_expires_at INTEGER;
ALTER TABLE organizations ADD COLUMN booking_change_hours INTEGER NOT NULL DEFAULT 24 CHECK (booking_change_hours BETWEEN 0 AND 720);
CREATE UNIQUE INDEX idx_booking_management_token ON bookings(management_token_hash) WHERE management_token_hash IS NOT NULL;
CREATE TABLE booking_events (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor TEXT NOT NULL CHECK (actor IN ('owner', 'customer')),
  kind TEXT NOT NULL,
  previous_start_at TEXT NOT NULL,
  previous_end_at TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(booking_id, version)
);
