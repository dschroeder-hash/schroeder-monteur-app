CREATE TABLE "team_absence" (
	"absence_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"half_day" "half_day" DEFAULT 'NONE' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "roles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "team_absence" ADD CONSTRAINT "team_absence_absence_id_absence_id_fk" FOREIGN KEY ("absence_id") REFERENCES "public"."absence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_absence" ADD CONSTRAINT "team_absence_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_absence" ADD CONSTRAINT "team_absence_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_absence_location_idx" ON "team_absence" USING btree ("location_id","from_date");--> statement-breakpoint
-- Team calendar without reasons (PROMPT 5.10): colleagues at the same location see "abwesend", never the type
-- or comment. Writes follow the absence policy, so whoever may change an absence may maintain its mirror row.
ALTER TABLE team_absence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE team_absence FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY team_absence_select ON team_absence FOR SELECT USING (
  app_is_worker() OR user_id = app_user_id() OR app_has_role('Werkstatt.Personal')
  OR EXISTS (SELECT 1 FROM user_location ul WHERE ul.user_id = app_user_id() AND ul.location_id = team_absence.location_id)
);
--> statement-breakpoint
CREATE POLICY team_absence_insert ON team_absence FOR INSERT WITH CHECK (
  app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()) OR app_has_role('Werkstatt.Personal')
);
--> statement-breakpoint
CREATE POLICY team_absence_update ON team_absence FOR UPDATE USING (
  app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()) OR app_has_role('Werkstatt.Personal')
) WITH CHECK (
  app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()) OR app_has_role('Werkstatt.Personal')
);
--> statement-breakpoint
CREATE POLICY team_absence_delete ON team_absence FOR DELETE USING (
  app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()) OR app_has_role('Werkstatt.Personal')
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION absence_team_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('REPORTED', 'APPROVED', 'CANCEL_REQUESTED') THEN
    INSERT INTO team_absence (absence_id, user_id, location_id, from_date, to_date, half_day)
    VALUES (NEW.id, NEW.user_id, NEW.location_id, NEW.from_date, NEW.to_date, NEW.half_day)
    ON CONFLICT (absence_id) DO UPDATE
      SET from_date = EXCLUDED.from_date, to_date = EXCLUDED.to_date, half_day = EXCLUDED.half_day,
          location_id = EXCLUDED.location_id;
  ELSE
    DELETE FROM team_absence WHERE absence_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER absence_team_mirror AFTER INSERT OR UPDATE ON absence FOR EACH ROW EXECUTE FUNCTION absence_team_mirror();
--> statement-breakpoint
-- Sick reports and vacation requests notify Personal, which usually shares no location with the Monteur.
DROP POLICY notification_insert ON notification;
--> statement-breakpoint
CREATE POLICY notification_insert ON notification FOR INSERT WITH CHECK (
  app_is_worker() OR user_id = app_user_id() OR app_shares_location(user_id)
  OR EXISTS (SELECT 1 FROM app_user u WHERE u.id = user_id AND 'Werkstatt.Personal' = ANY (u.roles))
  OR app_has_role('Werkstatt.Personal')
);
--> statement-breakpoint
-- Personal records sick reports on behalf and corrects their end → may queue (and see) BC transfers of absences.
DROP POLICY bc_transfer_all ON bc_transfer;
--> statement-breakpoint
CREATE POLICY bc_transfer_all ON bc_transfer FOR ALL USING (
  app_is_worker() OR app_has_role('Werkstatt.Admin') OR location_id = ANY (app_meister_locations())
  OR (app_has_role('Werkstatt.Personal') AND subject_type = 'absence')
) WITH CHECK (
  app_is_worker() OR location_id = ANY (app_meister_locations()) OR app_has_role('Werkstatt.Admin')
  OR (app_has_role('Werkstatt.Personal') AND subject_type = 'absence')
);
