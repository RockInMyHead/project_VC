CREATE TABLE investor_invites (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 500),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE investor_invite_claims (
  invite_id INTEGER NOT NULL REFERENCES investor_invites(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  browser_hash TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(invite_id,browser_hash),
  UNIQUE(invite_id,user_id)
);
