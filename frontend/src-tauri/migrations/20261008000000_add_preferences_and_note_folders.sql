-- Migration: app-wide key/value preferences and note folders
-- app_preferences holds small settings such as the global summary instruction.
-- note_folders lets users organise notes ("전체 노트" folders); meetings.note_folder_id is
-- NULL for notes that are not in any folder.

CREATE TABLE IF NOT EXISTS app_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE meetings ADD COLUMN note_folder_id TEXT;

CREATE INDEX IF NOT EXISTS idx_meetings_note_folder_id ON meetings(note_folder_id);
