-- Retention (OP-38): only the worker may delete audit entries and approvals after the legal retention period.
CREATE POLICY audit_log_delete_worker ON audit_log FOR DELETE USING (app_is_worker());
--> statement-breakpoint
CREATE POLICY approval_delete_worker ON approval FOR DELETE USING (app_is_worker());
