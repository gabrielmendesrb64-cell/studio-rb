CREATE TABLE IF NOT EXISTS lsh_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lsh_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10,2),
  duration INTEGER NOT NULL DEFAULT 60 CHECK (duration >= 15),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lsh_weekly_hours (
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  time_value TEXT NOT NULL,
  PRIMARY KEY (weekday, time_value)
);

CREATE TABLE IF NOT EXISTS lsh_date_hours (
  date_value DATE NOT NULL,
  time_value TEXT NOT NULL,
  PRIMARY KEY (date_value, time_value)
);

CREATE TABLE IF NOT EXISTS lsh_blocked_dates (
  date_value DATE PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS lsh_blocked_slots (
  date_value DATE NOT NULL,
  time_value TEXT NOT NULL,
  PRIMARY KEY (date_value, time_value)
);

CREATE TABLE IF NOT EXISTS lsh_gallery_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lsh_gallery (
  id TEXT PRIMARY KEY,
  src TEXT NOT NULL,
  title TEXT,
  caption TEXT,
  category_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lsh_bookings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  date_value DATE NOT NULL,
  time_value TEXT NOT NULL,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'Pendente',
  source TEXT NOT NULL DEFAULT 'site',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT,
  notifications JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_lsh_bookings_date_time ON lsh_bookings(date_value, time_value);
CREATE INDEX IF NOT EXISTS idx_lsh_bookings_phone ON lsh_bookings(phone);
CREATE INDEX IF NOT EXISTS idx_lsh_bookings_status ON lsh_bookings(status);

CREATE TABLE IF NOT EXISTS lsh_booking_services (
  booking_id TEXT NOT NULL REFERENCES lsh_bookings(id) ON DELETE CASCADE,
  service_id TEXT,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (booking_id, position)
);

CREATE TABLE IF NOT EXISTS lsh_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- V18: sinal PIX e comprovantes
ALTER TABLE lsh_bookings ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 20;
ALTER TABLE lsh_bookings ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Aguardando pagamento';
ALTER TABLE lsh_bookings ADD COLUMN IF NOT EXISTS proof_uploaded_at TIMESTAMPTZ;
ALTER TABLE lsh_bookings ADD COLUMN IF NOT EXISTS payment_reviewed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS lsh_payment_proofs (
  booking_id TEXT PRIMARY KEY REFERENCES lsh_bookings(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  original_name TEXT,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
