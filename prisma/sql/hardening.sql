-- Immuabilité du journal d'audit et interdiction de supprimer des opérations financières.
-- Idempotent : peut être rejoué après chaque `prisma db push`.
-- Les suppressions autorisées passent par l'application : elle active `jeeam.allow_delete` DANS la transaction
-- (set_config(..., true)) après contrôle des permissions, motif et confirmation, et inscrit la suppression au registre inaltérable.
CREATE OR REPLACE FUNCTION jeeam_forbid_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('jeeam.allow_delete', true) = 'on' THEN
    IF TG_LEVEL = 'STATEMENT' THEN RETURN NULL; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
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

-- Registre des suppressions : strictement en ajout seul (jamais de dérogation).
CREATE OR REPLACE FUNCTION jeeam_forbid_always() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registre des suppressions : modification interdite (%)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deletion_records_no_change ON deletion_records;
CREATE TRIGGER deletion_records_no_change BEFORE UPDATE OR DELETE ON deletion_records
  FOR EACH ROW EXECUTE FUNCTION jeeam_forbid_always();

DROP TRIGGER IF EXISTS deletion_records_no_truncate ON deletion_records;
CREATE TRIGGER deletion_records_no_truncate BEFORE TRUNCATE ON deletion_records
  FOR EACH STATEMENT EXECUTE FUNCTION jeeam_forbid_always();