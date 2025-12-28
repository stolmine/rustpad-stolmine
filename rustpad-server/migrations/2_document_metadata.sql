ALTER TABLE document ADD COLUMN name TEXT;
ALTER TABLE document ADD COLUMN created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'));
ALTER TABLE document ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'));
ALTER TABLE document ADD COLUMN deleted_at INTEGER;

CREATE INDEX idx_document_deleted_at ON document(deleted_at);
CREATE INDEX idx_document_updated_at ON document(updated_at);
