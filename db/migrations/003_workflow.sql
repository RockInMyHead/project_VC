ALTER TABLE tree_versions ADD COLUMN card_json TEXT CHECK(card_json IS NULL OR json_valid(card_json));
ALTER TABLE tree_versions ADD COLUMN review_comment TEXT NOT NULL DEFAULT '';
ALTER TABLE tree_versions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE project_subscriptions (
 project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(project_id,user_id)
);
CREATE TABLE request_receipts (
 user_id INTEGER NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 path TEXT NOT NULL, fingerprint TEXT NOT NULL, response_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(user_id,request_key)
);
UPDATE tree_versions SET card_json=(SELECT json_object('name',name,'summary',summary,'description',description,'field',field,'region',region,'ugt_level',ugt_level,'status',CASE WHEN status='draft' THEN 'active' ELSE status END) FROM projects WHERE projects.id=tree_versions.project_id);
DROP VIEW published_project_overview;
CREATE VIEW published_project_overview AS
SELECT p.public_id,p.code,p.slug,p.name,p.summary,p.field,p.region,p.status,p.ugt_level,
 p.last_published_at,u.full_name founder_name,COUNT(s.id) stage_count,
 SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) completed_stage_count,ROUND(AVG(s.progress),0) average_progress
FROM projects p JOIN users u ON u.id=p.founder_id
JOIN tree_versions tv ON tv.id=(SELECT id FROM tree_versions WHERE project_id=p.id AND state='published' ORDER BY version_number DESC LIMIT 1)
LEFT JOIN stages s ON s.tree_version_id=tv.id
WHERE p.status IN ('active','paused','completed') GROUP BY p.id;
