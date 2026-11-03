-- Immuabilité du journal d'audit et interdiction de supprimer des opérations financières.
-- Idempotent : peut être rejoué après chaque `prisma db push`.
CREATE OR REPLACE FUNCTION jeeam_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Opération interdite sur % (%) : données financières/audit immuables', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_change ON audit_logs;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION jeeam_forbid_change();

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION jeeam_forbid_change();

DROP TRIGGER IF EXISTS transactions_no_delete ON transactions;
CREATE TRIGGER transactions_no_delete BEFORE DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION jeeam_forbid_change();

DROP TRIGGER IF EXISTS attachments_no_delete ON attachments;
CREATE TRIGGER attachments_no_delete BEFORE DELETE ON attachments
  FOR EACH ROW EXECUTE FUNCTION jeeam_forbid_change();

DROP TRIGGER IF EXISTS balance_adjustments_no_delete ON balance_adjustments;
CREATE TRIGGER balance_adjustments_no_delete BEFORE DELETE ON balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION jeeam_forbid_change();
