-- Existing batches retain their original ordering until an administrator moves a row.
ALTER TABLE live_entries ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0);
CREATE INDEX idx_live_custom_sequence ON live_entries(batch_id, removed_at, sort_order, queue_group, source_created_at, import_order, id);

-- Keep ordering history separate from the existing, constrained audit action set.
CREATE TABLE live_order_requests (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  request_key TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES live_batches(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE(admin_id, request_key)
);

-- After customization, new and reselected entries append, even before playback.
CREATE TRIGGER live_custom_order_insert AFTER INSERT ON live_entries
BEGIN
  UPDATE live_entries SET sort_order = COALESCE((
    SELECT MAX(sort_order) + 1 FROM live_entries
    WHERE batch_id = NEW.batch_id AND id <> NEW.id AND removed_at IS NULL AND sort_order > 0
  ), 0) WHERE id = NEW.id;
END;
CREATE TRIGGER live_custom_order_reselect AFTER UPDATE OF removed_at ON live_entries
WHEN OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL
BEGIN
  UPDATE live_entries SET sort_order = COALESCE((
    SELECT MAX(sort_order) + 1 FROM live_entries
    WHERE batch_id = NEW.batch_id AND id <> NEW.id AND removed_at IS NULL AND sort_order > 0
  ), 0) WHERE id = NEW.id;
END;
