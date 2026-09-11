-- Excel rows are classified first and routed by a person afterwards.
-- Existing imported entries stay in their current live batch and are marked selected.
ALTER TABLE live_import_rows ADD COLUMN topic TEXT
  CHECK (topic IN ('released_hardware', 'released_software', 'unreleased_product', 'appeal', 'other'));
ALTER TABLE live_import_rows ADD COLUMN custom_topic TEXT;
ALTER TABLE live_import_rows ADD COLUMN routing_status TEXT
  CHECK (routing_status IN ('pending', 'selected', 'not_selected'));

UPDATE live_import_rows
SET topic = (
      SELECT e.topic FROM live_entries e
      WHERE e.import_job_id = live_import_rows.job_id
        AND e.import_row_number = live_import_rows.row_number
      LIMIT 1
    ),
    custom_topic = (
      SELECT e.custom_topic FROM live_entries e
      WHERE e.import_job_id = live_import_rows.job_id
        AND e.import_row_number = live_import_rows.row_number
      LIMIT 1
    ),
    routing_status = CASE WHEN EXISTS (
      SELECT 1 FROM live_entries e
      WHERE e.import_job_id = live_import_rows.job_id
        AND e.import_row_number = live_import_rows.row_number
        AND e.removed_at IS NULL
    ) THEN 'selected' ELSE 'not_selected' END
WHERE status = 'imported';

CREATE INDEX idx_live_import_routing
  ON live_import_rows(status, routing_status, job_id, row_number);

-- Import creation no longer reserves a queue position: a classified row only joins
-- the queue when an administrator selects it. Once playback has started, every new
-- selection is appended in the exact order in which it was selected.
DROP TRIGGER live_import_queue;
DROP TRIGGER live_entry_queue;
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
