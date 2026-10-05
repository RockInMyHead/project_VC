ALTER TABLE stages ADD COLUMN choice_options_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE stages ADD COLUMN selected_choice INTEGER;
