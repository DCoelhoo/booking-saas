CREATE TABLE staff_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,id)
);
INSERT INTO staff_members(id,organization_id,name) SELECT 'staff:' || o.id,o.id,COALESCE(u.full_name,o.name) FROM organizations o LEFT JOIN users u ON u.organization_id=o.id;
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','staff')),
  staff_id TEXT REFERENCES staff_members(id)
);
INSERT INTO users_new(id,organization_id,email,full_name,password_hash,created_at,staff_id) SELECT id,organization_id,email,full_name,password_hash,created_at,'staff:' || organization_id FROM users;
CREATE TABLE sessions_new(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO sessions_new SELECT * FROM sessions;
CREATE TABLE password_change_tokens_new(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users_new(id) ON DELETE CASCADE,password_hash_at_request TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO password_change_tokens_new SELECT * FROM password_change_tokens;
DROP TABLE sessions;
DROP TABLE password_change_tokens;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
ALTER TABLE sessions_new RENAME TO sessions;
ALTER TABLE password_change_tokens_new RENAME TO password_change_tokens;
CREATE UNIQUE INDEX idx_one_owner ON users(organization_id) WHERE role='owner';
CREATE UNIQUE INDEX idx_staff_user ON users(staff_id) WHERE role='staff';
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE TRIGGER organization_initial_staff AFTER INSERT ON organizations BEGIN INSERT INTO staff_members(id,organization_id,name) VALUES ('staff:' || NEW.id,NEW.id,NEW.name); END;
CREATE TRIGGER owner_initial_staff AFTER INSERT ON users WHEN NEW.role='owner' BEGIN UPDATE users SET staff_id='staff:' || NEW.organization_id WHERE id=NEW.id; UPDATE staff_members SET name=NEW.full_name WHERE id='staff:' || NEW.organization_id; END;
ALTER TABLE bookings ADD COLUMN staff_id TEXT REFERENCES staff_members(id);
UPDATE bookings SET staff_id='staff:' || organization_id;
CREATE TRIGGER booking_initial_staff AFTER INSERT ON bookings WHEN NEW.staff_id IS NULL BEGIN UPDATE bookings SET staff_id='staff:' || NEW.organization_id WHERE id=NEW.id; END;
CREATE INDEX idx_booking_staff_time ON bookings(organization_id,staff_id,start_at);
CREATE TABLE staff_invitations(staff_id TEXT PRIMARY KEY REFERENCES staff_members(id),token_hash TEXT NOT NULL UNIQUE,email TEXT NOT NULL UNIQUE COLLATE NOCASE,expires_at INTEGER NOT NULL);
