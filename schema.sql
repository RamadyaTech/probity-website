-- Cloudflare D1 schema for contact form leads.
-- Create:  npx wrangler d1 create probity-leads
-- Apply:   npx wrangler d1 execute probity-leads --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  company    TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  phone      TEXT,
  interest   TEXT,
  message    TEXT    NOT NULL,
  ip         TEXT,
  ua         TEXT,
  emailed    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_emailed ON leads (emailed);
