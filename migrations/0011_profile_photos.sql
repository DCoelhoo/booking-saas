ALTER TABLE staff_members ADD COLUMN photo_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_staff_photo_key ON staff_members(photo_key) WHERE photo_key != '';
