ALTER TABLE bookings ADD COLUMN customer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN customer_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN booking_source TEXT NOT NULL DEFAULT 'internal' CHECK (booking_source IN ('internal', 'public'));
ALTER TABLE bookings ADD COLUMN total_cents INTEGER;
ALTER TABLE bookings ADD COLUMN online_due_cents INTEGER;
ALTER TABLE bookings ADD COLUMN on_site_due_cents INTEGER;
ALTER TABLE bookings ADD COLUMN payment_mode TEXT;
ALTER TABLE bookings ADD COLUMN service_name_snapshot TEXT;
ALTER TABLE bookings ADD COLUMN public_request_id TEXT;
ALTER TABLE bookings ADD COLUMN public_request_hash TEXT;
CREATE UNIQUE INDEX idx_public_booking_request ON bookings(organization_id, public_request_id)
WHERE public_request_id IS NOT NULL;
