-- Users may create notifications for colleagues at a shared location (Meister → Monteur on planning,
-- Monteur → Meister on correction requests). Reading stays restricted to the recipient.
CREATE OR REPLACE FUNCTION app_shares_location(target_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_location a JOIN user_location b ON a.location_id = b.location_id
    WHERE a.user_id = app_user_id() AND b.user_id = target_user
  )
$$;
--> statement-breakpoint
DROP POLICY notification_all ON notification;
--> statement-breakpoint
CREATE POLICY notification_select ON notification FOR SELECT USING (app_is_worker() OR user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY notification_insert ON notification FOR INSERT WITH CHECK (app_is_worker() OR user_id = app_user_id() OR app_shares_location(user_id));
--> statement-breakpoint
CREATE POLICY notification_update ON notification FOR UPDATE USING (app_is_worker() OR user_id = app_user_id()) WITH CHECK (app_is_worker() OR user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY notification_delete ON notification FOR DELETE USING (app_is_worker() OR user_id = app_user_id());
--> statement-breakpoint
-- Approvals are visible to the approver, the worker, Personal and Meister of the subject's location (checked in the service).
DROP POLICY approval_select ON approval;
--> statement-breakpoint
CREATE POLICY approval_select ON approval FOR SELECT USING (
  app_is_worker() OR approved_by = app_user_id() OR app_has_role('Werkstatt.Personal')
  OR (app_has_role('Werkstatt.Meister') AND cardinality(app_meister_locations()) > 0)
);
--> statement-breakpoint
-- The approval decision is also needed to update approved rows; time entries can be approved by the Meister only.
CREATE POLICY time_entry_approve_restrict ON time_entry AS RESTRICTIVE FOR UPDATE
  USING (app_is_worker() OR state = 'OPEN' OR location_id = ANY (app_meister_locations()))
  WITH CHECK (app_is_worker() OR state = 'OPEN' OR location_id = ANY (app_meister_locations()));
