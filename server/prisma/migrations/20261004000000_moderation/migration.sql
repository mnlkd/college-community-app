-- Batch 5: Moderation and Audit.

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('DISMISSED', 'UPHELD_WARNING', 'UPHELD_RESTRICTION', 'UPHELD_NO_CONSEQUENCE');

-- AlterTable
ALTER TABLE "audit_record" ADD COLUMN     "outcome" "audit_outcome",
ADD COLUMN     "report_id" UUID;

-- AlterTable: an image dropped from its post while held as evidence keeps its row without a position.
ALTER TABLE "post_image" ALTER COLUMN "position" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "audit_record_report_id_idx" ON "audit_record"("report_id");

-- AddForeignKey
ALTER TABLE "audit_record" ADD CONSTRAINT "audit_record_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit records are append-only (NFR-7). An update may only remove references (anonymization,
-- or ON DELETE SET NULL) and set purge_after; a row may be deleted only once purge_after has
-- passed. TRUNCATE (test resets) does not fire row triggers.
CREATE FUNCTION audit_record_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.purge_after IS NOT NULL AND OLD.purge_after <= now() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit records are append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.action_code IS DISTINCT FROM OLD.action_code
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR (NEW.actor_admin_id IS NOT NULL AND NEW.actor_admin_id IS DISTINCT FROM OLD.actor_admin_id)
     OR (NEW.target_member_id IS NOT NULL AND NEW.target_member_id IS DISTINCT FROM OLD.target_member_id)
     OR (NEW.target_admin_id IS NOT NULL AND NEW.target_admin_id IS DISTINCT FROM OLD.target_admin_id)
     OR (NEW.report_id IS NOT NULL AND NEW.report_id IS DISTINCT FROM OLD.report_id) THEN
    RAISE EXCEPTION 'audit records are append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_record_append_only
BEFORE UPDATE OR DELETE ON "audit_record"
FOR EACH ROW EXECUTE FUNCTION audit_record_append_only();
