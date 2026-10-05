ALTER TABLE stages ADD COLUMN outcome TEXT CHECK (outcome IN ('success','failure','inconclusive'));
ALTER TABLE stages ADD COLUMN outcome_note TEXT NOT NULL DEFAULT '';
ALTER TABLE stages ADD COLUMN outcome_at TEXT;
