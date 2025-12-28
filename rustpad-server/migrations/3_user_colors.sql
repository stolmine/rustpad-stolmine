-- User color preferences (global, not per-document)
CREATE TABLE IF NOT EXISTS user_color (
    email TEXT PRIMARY KEY NOT NULL,
    hue INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
