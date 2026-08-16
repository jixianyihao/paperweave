ALTER TABLE items ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (metadata_status IN ('pending', 'complete', 'failed'));
