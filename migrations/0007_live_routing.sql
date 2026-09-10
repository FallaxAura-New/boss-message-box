-- Additive migration: public submissions, replies, administrators and images stay intact.
ALTER TABLE feedback ADD COLUMN routing_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (routing_status IN ('pending', 'selected', 'not_selected'));
CREATE INDEX idx_feedback_routing ON feedback(moderation_status, routing_status, created_at, id);

CREATE TABLE live_batches (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  archived_at INTEGER,
  archived_by TEXT REFERENCES admins(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  playback_started_at INTEGER,
  next_queue_group INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  successor_id TEXT UNIQUE,
  CHECK ((status = 'active' AND archived_at IS NULL AND archived_by IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL AND archived_by IS NOT NULL))
);
CREATE UNIQUE INDEX idx_one_active_batch ON live_batches(status) WHERE status = 'active';
INSERT INTO live_batches(id, started_at, status)
VALUES ('00000000-0000-4000-8000-000000000007', unixepoch() * 1000, 'active');

CREATE TABLE live_import_jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES live_batches(id),
  file_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size BETWEEN 1 AND 2097152),
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 1 AND 500),
  created_by TEXT NOT NULL REFERENCES admins(id),
  created_at INTEGER NOT NULL,
  queue_group INTEGER NOT NULL DEFAULT 0,
  UNIQUE(batch_id, file_hash)
);
CREATE TABLE live_import_rows (
  job_id TEXT NOT NULL REFERENCES live_import_jobs(id),
  row_number INTEGER NOT NULL CHECK (row_number BETWEEN 2 AND 501),
  nickname TEXT NOT NULL CHECK (length(trim(nickname)) BETWEEN 1 AND 40),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed', 'imported')),
  attempt_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  PRIMARY KEY(job_id, row_number)
);
CREATE INDEX idx_live_import_work ON live_import_rows(status, lease_until);

CREATE TABLE live_entries (
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
  UNIQUE(import_job_id, import_row_number),
  FOREIGN KEY(import_job_id, import_row_number) REFERENCES live_import_rows(job_id, row_number),
  CHECK ((source_type = 'public' AND feedback_id IS NOT NULL AND import_job_id IS NULL AND import_row_number IS NULL)
    OR (source_type = 'imported' AND feedback_id IS NULL AND import_job_id IS NOT NULL AND import_row_number IS NOT NULL)),
  CHECK ((topic = 'other' AND custom_topic IS NOT NULL AND length(trim(custom_topic)) BETWEEN 1 AND 60 AND (source_type = 'public' OR trim(custom_topic) <> '其他'))
    OR (topic <> 'other' AND custom_topic IS NULL))
);
CREATE INDEX idx_live_sequence ON live_entries(batch_id, removed_at, queue_group, source_created_at, import_order, id);
-- A batch becomes an append-only playback queue on the first live-mode entry.
-- Each import reserves one group; asynchronous completions retain Excel row order.
CREATE TRIGGER live_import_queue AFTER INSERT ON live_import_jobs
WHEN EXISTS (SELECT 1 FROM live_batches WHERE id = NEW.batch_id AND playback_started_at IS NOT NULL)
BEGIN
  UPDATE live_batches SET next_queue_group = next_queue_group + 1 WHERE id = NEW.batch_id;
  UPDATE live_import_jobs SET queue_group = (SELECT next_queue_group FROM live_batches WHERE id = NEW.batch_id) WHERE id = NEW.id;
END;
CREATE TRIGGER live_entry_queue AFTER INSERT ON live_entries
BEGIN
  UPDATE live_batches SET revision = revision + 1 WHERE id = NEW.batch_id;
  UPDATE live_batches SET next_queue_group = next_queue_group + 1
    WHERE id = NEW.batch_id AND playback_started_at IS NOT NULL AND NEW.source_type = 'public';
  UPDATE live_entries SET queue_group = CASE WHEN NEW.source_type = 'imported'
    THEN (SELECT queue_group FROM live_import_jobs WHERE id = NEW.import_job_id)
    ELSE (SELECT next_queue_group FROM live_batches WHERE id = NEW.batch_id) END
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
-- Keep the existing audit table and its historical constraints unchanged.
CREATE TABLE live_audit_logs (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  action TEXT NOT NULL CHECK (action IN ('routing_selected', 'routing_not_selected', 'live_removed', 'import_created', 'import_retried', 'batch_rotated')),
  batch_id TEXT NOT NULL REFERENCES live_batches(id),
  feedback_id TEXT REFERENCES feedback(id),
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(admin_id, request_key)
);
