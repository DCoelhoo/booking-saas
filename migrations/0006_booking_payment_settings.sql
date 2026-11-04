ALTER TABLE organizations ADD COLUMN booking_payment_settings TEXT NOT NULL DEFAULT
'{"mode":"on_site","deposit_type":"percentage","deposit_value":30}'
CHECK (json_valid(booking_payment_settings));
