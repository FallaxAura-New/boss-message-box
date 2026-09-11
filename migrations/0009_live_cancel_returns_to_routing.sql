-- Cancelling a live entry returns both public submissions and Excel rows to routing.
-- Rebuild live_entries so one Excel row may be selected again in a later batch while
-- each archived batch keeps its own immutable snapshot.
CREATE TABLE live_entries_next (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES live_batches(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('public', 'imported')),
  feedback_id TEXT REFERENCES feedback(id),
  nickname TEXT NOT NULL CHECK (length(trim(nickname)) BETWEEN 1 AND 40),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 2000),
  topic TEXT NOT NULL CHECK (topic IN ('released_hardware', 'released_software', 'unreleased_product', 'appeal', 'other')),
  custom_topic TEXT,
  source_created_at INTEGER NOT NULL,
  import_order INTEGER NOT NULL DEFAULT 0,
  queue_group INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  added_by TEXT NOT NULL REFERENCES admins(id),
  import_job_id TEXT,
  import_row_number INTEGER,
  removed_at INTEGER,
  removed_by TEXT REFERENCES admins(id),
  UNIQUE(batch_id, feedback_id),
  UNIQUE(batch_id, import_job_id, import_row_number),
  FOREIGN KEY(import_job_id, import_row_number) REFERENCES live_import_rows(job_id, row_number),
  CHECK ((source_type = 'public' AND feedback_id IS NOT NULL AND import_job_id IS NULL AND import_row_number IS NULL)
    OR (source_type = 'imported' AND feedback_id IS NULL AND import_job_id IS NOT NULL AND import_row_number IS NOT NULL)),
  CHECK ((topic = 'other' AND custom_topic IS NOT NULL AND length(trim(custom_topic)) BETWEEN 1 AND 60 AND (source_type = 'public' OR trim(custom_topic) <> '其他'))
    OR (topic <> 'other' AND custom_topic IS NULL))
);

INSERT INTO live_entries_next
SELECT * FROM live_entries;

DROP TABLE live_entries;
ALTER TABLE live_entries_next RENAME TO live_entries;

CREATE INDEX idx_live_sequence ON live_entries(batch_id, removed_at, queue_group, source_created_at, import_order, id);
CREATE TRIGGER live_entry_queue AFTER INSERT ON live_entries
BEGIN
  UPDATE live_batches SET revision = revision + 1 WHERE id = NEW.batch_id;
  UPDATE live_batches SET next_queue_group = next_queue_group + 1
    WHERE id = NEW.batch_id AND playback_started_at IS NOT NULL;
  UPDATE live_entries SET queue_group = CASE
    WHEN EXISTS (SELECT 1 FROM live_batches WHERE id = NEW.batch_id AND playback_started_at IS NOT NULL)
      THEN (SELECT next_queue_group FROM live_batches WHERE id = NEW.batch_id)
    ELSE 0 END
    WHERE id = NEW.id;
END;
CREATE TRIGGER live_entry_reselected AFTER UPDATE OF removed_at ON live_entries
WHEN OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL
  AND EXISTS (SELECT 1 FROM live_batches WHERE id = NEW.batch_id AND playback_started_at IS NOT NULL)
BEGIN
  UPDATE live_batches SET next_queue_group = next_queue_group + 1 WHERE id = NEW.batch_id;
  UPDATE live_entries SET queue_group = (SELECT next_queue_group FROM live_batches WHERE id = NEW.batch_id) WHERE id = NEW.id;
END;
CREATE TRIGGER live_membership_revision AFTER UPDATE OF removed_at ON live_entries
WHEN OLD.removed_at IS NOT NEW.removed_at
BEGIN
  UPDATE live_batches SET revision = revision + 1 WHERE id = NEW.batch_id;
END;

-- Rows cancelled before this migration used not_selected. Only rows with an actual
-- removed live snapshot are returned; rows explicitly declined in routing stay declined.
UPDATE feedback
SET routing_status = 'pending', is_todo = 0, updated_at = unixepoch() * 1000
WHERE routing_status = 'not_selected'
  AND EXISTS (
    SELECT 1 FROM live_entries entry
    WHERE entry.feedback_id = feedback.id AND entry.removed_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM live_entries entry
    JOIN live_batches batch ON batch.id = entry.batch_id
    WHERE entry.feedback_id = feedback.id AND entry.removed_at IS NULL AND batch.status = 'active'
  );

UPDATE live_import_rows
SET routing_status = 'pending'
WHERE status = 'imported' AND routing_status = 'not_selected'
  AND EXISTS (
    SELECT 1 FROM live_entries entry
    WHERE entry.import_job_id = live_import_rows.job_id
      AND entry.import_row_number = live_import_rows.row_number
      AND entry.removed_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM live_entries entry
    JOIN live_batches batch ON batch.id = entry.batch_id
    WHERE entry.import_job_id = live_import_rows.job_id
      AND entry.import_row_number = live_import_rows.row_number
      AND entry.removed_at IS NULL
      AND batch.status = 'active'
  );
