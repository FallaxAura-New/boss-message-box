-- Deleted content is not retained. Metadata records the action and prevents a
-- delayed retry of the original create request from resurrecting the reply.
CREATE TABLE reply_deletions (
  reply_id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  reply_admin_id TEXT REFERENCES admins(id) ON DELETE RESTRICT,
  request_key TEXT,
  deleted_by TEXT NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  deleted_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_reply_deletions_request ON reply_deletions(reply_admin_id, request_key);
CREATE INDEX idx_reply_deletions_feedback ON reply_deletions(feedback_id);
