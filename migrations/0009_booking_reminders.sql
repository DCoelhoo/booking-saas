ALTER TABLE email_outbox ADD COLUMN booking_id TEXT REFERENCES bookings(id);
ALTER TABLE email_outbox ADD COLUMN booking_version INTEGER;
ALTER TABLE email_outbox ADD COLUMN booking_start_at TEXT;
CREATE INDEX idx_email_outbox_booking ON email_outbox(booking_id, booking_version);
