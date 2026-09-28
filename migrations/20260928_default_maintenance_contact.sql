-- ResLink A02: default maintenance contact per residency
-- Safe to run once or repeatedly.

ALTER TABLE residencies
  ADD COLUMN IF NOT EXISTS default_artisan_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'residencies_default_artisan_id_fkey'
  ) THEN
    ALTER TABLE residencies
      ADD CONSTRAINT residencies_default_artisan_id_fkey
      FOREIGN KEY (default_artisan_id)
      REFERENCES artisans(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_residencies_default_artisan_id
  ON residencies(default_artisan_id);

-- Backfill only where the residency currently has exactly one linked artisan.
-- Residencies with zero or multiple artisans remain unset so the manager can
-- make an explicit choice in the UI.
WITH single_link AS (
  SELECT
    residency_id,
    MIN(artisan_id::text)::uuid AS artisan_id
  FROM residency_artisans
  GROUP BY residency_id
  HAVING COUNT(*) = 1
)
UPDATE residencies r
SET default_artisan_id = single_link.artisan_id
FROM single_link
WHERE r.id = single_link.residency_id
  AND r.default_artisan_id IS NULL;

-- Assign existing open, unassigned requests only where a default contact now exists.
-- Pending requests become claimed; any other non-terminal status is preserved.
UPDATE maintenance_requests m
SET
  artisan_id = r.default_artisan_id,
  status = CASE
    WHEN m.status = 'pending' OR m.status IS NULL THEN 'claimed'
    ELSE m.status
  END,
  claimed_at = CASE
    WHEN m.status = 'pending' OR m.status IS NULL THEN COALESCE(m.claimed_at, NOW())
    ELSE m.claimed_at
  END
FROM residencies r
WHERE m.residency_id = r.id
  AND r.default_artisan_id IS NOT NULL
  AND m.artisan_id IS NULL
  AND COALESCE(m.status, 'pending') NOT IN ('completed', 'cancelled');
