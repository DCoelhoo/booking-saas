ALTER TABLE organizations ADD COLUMN availability TEXT NOT NULL DEFAULT
'{"weekly":[[{"start":"09:00","end":"18:00"}],[{"start":"09:00","end":"18:00"}],[{"start":"09:00","end":"18:00"}],[{"start":"09:00","end":"18:00"}],[{"start":"09:00","end":"18:00"}],[{"start":"09:00","end":"18:00"}],[{"start":"09:00","end":"18:00"}]],"closures":[]}'
CHECK (json_valid(availability));
