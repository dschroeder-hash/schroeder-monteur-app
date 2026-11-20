-- System messages in the order chat on every status change (PROMPT 5.8), whatever path changed the status
-- (stamping, Monteur, Meister, planning board, part request, BC sync).
CREATE OR REPLACE FUNCTION app_status_label(s app_status) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'NEU' THEN 'Neu'
    WHEN 'EINGEPLANT' THEN 'Eingeplant'
    WHEN 'UNTERWEGS' THEN 'Unterwegs'
    WHEN 'IN_ARBEIT' THEN 'In Arbeit'
    WHEN 'WARTET_TEILE' THEN 'Wartet auf Teile'
    WHEN 'WARTET_KUNDE' THEN 'Wartet auf Kunde/Freigabe'
    WHEN 'FERTIG_DOKU_OFFEN' THEN 'Fertig – Doku offen'
    WHEN 'FERTIG' THEN 'Fertig'
    WHEN 'FREIGEGEBEN' THEN 'Freigegeben (Meister)'
    WHEN 'ABGERECHNET' THEN 'Abgerechnet'
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION order_status_chat_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO chat_message (id, order_id, author_id, body, is_system)
  VALUES (
    gen_random_uuid(),
    NEW.order_id,
    NULL,
    'Status: ' || app_status_label(NEW.to_status)
      || CASE NEW.source WHEN 'STEMPELUNG' THEN ' (automatisch)' WHEN 'BC' THEN ' (aus BC)' ELSE '' END
      || CASE WHEN NEW.note IS NOT NULL AND NEW.note <> '' THEN ' – ' || NEW.note ELSE '' END,
    true
  );
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_status_event_chat AFTER INSERT ON order_status_event FOR EACH ROW EXECUTE FUNCTION order_status_chat_message();
--> statement-breakpoint
-- Chat messages and read receipts: authors write, nobody edits other people's messages via the API role.
REVOKE UPDATE ON chat_message FROM monteur_app;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_message_tx_idx ON chat_message (tx_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS work_report_tx_idx ON work_report (tx_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS photo_tx_idx ON photo (tx_id);
