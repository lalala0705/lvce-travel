CREATE TABLE ai_settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE ai_quota (
  name TEXT PRIMARY KEY,
  amount INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE ai_requests (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
