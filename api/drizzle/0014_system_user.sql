-- Without a Meister in the app (E-66) the worker hands times, withdrawals and finished orders to BC itself.
-- Approvals, status events and audit entries need an actor: the technical user "Automatik" (no Entra account,
-- inactive – it can never sign in).
INSERT INTO app_user (id, entra_oid, display_name, email, active)
VALUES ('00000000-0000-0000-0000-00000000a170', '00000000-0000-0000-0000-00000000a170', 'Automatik', 'automatik@system.invalid', false)
ON CONFLICT (id) DO NOTHING;
