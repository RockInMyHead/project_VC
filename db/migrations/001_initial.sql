PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('investor','founder','fund_staff','super_admin')),
  name TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  phone TEXT COLLATE NOCASE UNIQUE,
  organization TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','blocked','archived')),
  two_factor_enabled INTEGER NOT NULL DEFAULT 1 CHECK (two_factor_enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

CREATE TABLE registration_requests (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('investor','founder')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  organization TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  field TEXT NOT NULL,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','completed','archived')),
  ugt_level INTEGER NOT NULL DEFAULT 1 CHECK (ugt_level BETWEEN 1 AND 9),
  founder_id INTEGER NOT NULL REFERENCES users(id),
  fund_manager_id INTEGER REFERENCES users(id),
  last_published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL CHECK (member_role IN ('owner','researcher','viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (project_id,user_id)
);

CREATE TABLE tree_versions (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','in_review','published','rejected')),
  change_summary TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  submitted_at TEXT,
  reviewed_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(project_id,version_number)
);

CREATE TABLE stages (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  tree_version_id INTEGER NOT NULL REFERENCES tree_versions(id) ON DELETE CASCADE,
  parent_stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  branch_code TEXT NOT NULL DEFAULT 'main',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  ugt_level INTEGER CHECK (ugt_level BETWEEN 1 AND 9),
  owner_id INTEGER REFERENCES users(id),
  started_at TEXT,
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((status='completed' AND progress=100) OR status!='completed')
);

CREATE TABLE evidence (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  checksum_sha256 TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE project_questions (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 2 AND 5000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE question_replies (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  question_id INTEGER NOT NULL REFERENCES project_questions(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 2 AND 5000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_public_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE otp_challenges (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','phone_verify','password_reset')),
  code_hash TEXT NOT NULL,
  attempts_left INTEGER NOT NULL DEFAULT 3 CHECK (attempts_left BETWEEN 0 AND 5),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_public_id TEXT,
  ip_address TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_users_role_status ON users(role_id,status);
CREATE INDEX idx_projects_status_updated ON projects(status,updated_at DESC);
CREATE INDEX idx_projects_founder ON projects(founder_id);
CREATE INDEX idx_tree_versions_project_state ON tree_versions(project_id,state,version_number DESC);
CREATE INDEX idx_stages_tree_parent ON stages(tree_version_id,parent_stage_id,position);
CREATE INDEX idx_questions_project_created ON project_questions(project_id,created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id,read_at,created_at DESC);
CREATE INDEX idx_sessions_user_active ON auth_sessions(user_id,revoked_at,expires_at);
CREATE INDEX idx_audit_actor_created ON audit_log(actor_id,created_at DESC);
CREATE INDEX idx_audit_entity_created ON audit_log(entity_type,entity_public_id,created_at DESC);

CREATE TRIGGER trg_project_updated AFTER UPDATE ON projects
BEGIN UPDATE projects SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;

CREATE TRIGGER trg_stage_updated AFTER UPDATE ON stages
BEGIN UPDATE stages SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;

CREATE VIEW published_project_overview AS
SELECT p.public_id,p.code,p.slug,p.name,p.summary,p.field,p.region,p.status,p.ugt_level,
       p.last_published_at,u.full_name AS founder_name,
       COUNT(DISTINCT s.id) AS stage_count,
       SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS completed_stage_count,
       ROUND(AVG(s.progress),0) AS average_progress
FROM projects p
JOIN users u ON u.id=p.founder_id
LEFT JOIN tree_versions tv ON tv.project_id=p.id AND tv.state='published'
LEFT JOIN stages s ON s.tree_version_id=tv.id
WHERE p.status IN ('active','completed')
GROUP BY p.id;

CREATE VIEW overdue_active_projects AS
SELECT p.* FROM projects p
WHERE p.status='active' AND (p.last_published_at IS NULL OR p.last_published_at < datetime('now','-7 days'));
