-- Gap-free delta pull (ARCHITEKTUR 4.1):
-- Every write stores the writing transaction id (tx_id). A pull returns rows with tx_id >= cursor and hands out
-- pg_snapshot_xmin(pg_current_snapshot()) as the next cursor. Transactions still running at pull time have an
-- id >= xmin and are therefore delivered by the next pull once committed – nothing is skipped, duplicates are
-- harmless because the client upserts.
CREATE OR REPLACE FUNCTION set_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.row_version := nextval('row_version_seq');
  NEW.tx_id := pg_current_xact_id();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS service_order_tx_idx ON service_order (tx_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assignment_tx_idx ON assignment (tx_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stamp_event_tx_idx ON stamp_event (user_id, tx_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS time_entry_tx_idx ON time_entry (user_id, tx_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_status_event_tx_idx ON order_status_event (tx_id);
--> statement-breakpoint
-- Derived (still open) time entries are recomputed from stamp events and may be deleted by their owner.
-- RESTRICTIVE: combined with the permissive policy, so Personal/Meister can never delete via the API role.
GRANT DELETE ON time_entry TO monteur_app;
--> statement-breakpoint
CREATE POLICY time_entry_delete_restrict ON time_entry AS RESTRICTIVE FOR DELETE
  USING (app_is_worker() OR (state = 'OPEN' AND segment_key IS NOT NULL AND user_id = app_user_id()));
