-- CreateEnum
CREATE TYPE "save_target_type" AS ENUM ('POST', 'OPPORTUNITY', 'GROUP');

-- CreateEnum
CREATE TYPE "group_state" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "membership_state" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'LEFT');

-- CreateEnum
CREATE TYPE "transfer_state" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('STUDENT', 'STAFF', 'ALUMNI');

-- CreateEnum
CREATE TYPE "alumni_status" AS ENUM ('SELF_REPORTED', 'VERIFIED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "account_state" AS ENUM ('ACTIVE', 'DISABLED', 'DELETED');

-- CreateEnum
CREATE TYPE "admin_state" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "programme" AS ENUM ('COMPUTER_SCIENCE', 'SOFTWARE_ENGINEERING');

-- CreateEnum
CREATE TYPE "registration_path" AS ENUM ('INSTITUTIONAL_EMAIL', 'PERSONAL_EMAIL');

-- CreateEnum
CREATE TYPE "review_decision" AS ENUM ('PENDING', 'VERIFIED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "graduation_decision" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- CreateEnum
CREATE TYPE "mentorship_state" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED', 'WITHDRAWN', 'ENDED');

-- CreateEnum
CREATE TYPE "contact_kind" AS ENUM ('EMAIL', 'TELEGRAM', 'PHONE', 'OTHER');

-- CreateEnum
CREATE TYPE "report_target_type" AS ENUM ('POST', 'COMMENT', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "guideline_category" AS ENUM ('HARASSMENT', 'SPAM', 'IMPERSONATION', 'PRIVATE_INFORMATION', 'FALSE_INFORMATION');

-- CreateEnum
CREATE TYPE "report_state" AS ENUM ('PENDING', 'UPHELD', 'DISMISSED');

-- CreateEnum
CREATE TYPE "consequence_kind" AS ENUM ('WARNING', 'RESTRICTION');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('ALUMNI_REVIEWED', 'GRADUATION_DECIDED', 'STAFF_EMAIL_ADDED', 'STAFF_EMAIL_REMOVED', 'ROLE_CORRECTED', 'MEMBER_EMAIL_UPDATED', 'ACCOUNT_DISABLED', 'ACCOUNT_RESTORED', 'FAKE_ACCOUNT_DELETED', 'ADMINISTRATOR_CREATED', 'ADMINISTRATOR_MFA_RESET', 'ADMINISTRATOR_REMOVED', 'ADMINISTRATOR_EMAIL_CHANGED', 'REPORT_DECIDED');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('COMMENT', 'REPLY', 'LIKE', 'MENTORSHIP_REQUEST', 'MENTORSHIP_OUTCOME', 'GROUP_REQUEST', 'GROUP_OUTCOME', 'GROUP_TRANSFER', 'ALUMNI_DECISION', 'GRADUATION_DECISION', 'MODERATION_OUTCOME', 'REPORT_OUTCOME');

-- CreateEnum
CREATE TYPE "opportunity_type" AS ENUM ('INTERNSHIP', 'PART_TIME', 'FULL_TIME');

-- CreateEnum
CREATE TYPE "work_arrangement" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "opportunity_state" AS ENUM ('OPEN', 'CLOSED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "post_state" AS ENUM ('VISIBLE', 'ARCHIVED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "comment_state" AS ENUM ('VISIBLE', 'DELETED', 'HIDDEN');

-- CreateTable
CREATE TABLE "saved_item" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "target_type" "save_target_type" NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "max_occupancy" SMALLINT NOT NULL,
    "coordination_details" VARCHAR(5000),
    "state" "group_state" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, "title"), 'A') || setweight(to_tsvector('simple'::regconfig, "description"), 'C')) STORED,

    CONSTRAINT "group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_membership" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "state" "membership_state" NOT NULL DEFAULT 'PENDING',
    "joined_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "group_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_transfer" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "from_owner_id" UUID NOT NULL,
    "to_member_id" UUID NOT NULL,
    "state" "transfer_state" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "group_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_account" (
    "id" UUID NOT NULL,
    "auth_user_id" UUID,
    "email" VARCHAR(254),
    "display_name" VARCHAR(100),
    "role" "role" NOT NULL,
    "alumni_status" "alumni_status",
    "programme" "programme",
    "state" "account_state" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "member_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile" (
    "member_id" UUID NOT NULL,
    "bio" VARCHAR(500),
    "study_or_expertise" VARCHAR(160),
    "graduation_year" SMALLINT,
    "current_position" VARCHAR(160),
    "profile_image_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profile_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "profile_image" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrator_account" (
    "id" UUID NOT NULL,
    "auth_user_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "state" "admin_state" NOT NULL DEFAULT 'ACTIVE',
    "totp_required" BOOLEAN NOT NULL DEFAULT true,
    "is_first_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrator_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_session" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "supabase_session_id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_email_entry" (
    "email" VARCHAR(254) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maintained_by_admin_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_email_entry_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "alumni_review" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "registration_path" "registration_path" NOT NULL,
    "claimed_full_name" VARCHAR(100) NOT NULL,
    "identifying_context" VARCHAR(1000),
    "decision" "review_decision" NOT NULL DEFAULT 'PENDING',
    "private_reason" VARCHAR(1000),
    "reviewed_by_admin_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alumni_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graduation_request" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "programme" "programme" NOT NULL,
    "graduation_year" SMALLINT NOT NULL,
    "decision" "graduation_decision" NOT NULL DEFAULT 'PENDING',
    "private_reason" VARCHAR(1000),
    "reviewed_by_admin_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graduation_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_email_hash" (
    "email_hmac" TEXT NOT NULL,
    "blocked_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_email_hash_pkey" PRIMARY KEY ("email_hmac")
);

-- CreateTable
CREATE TABLE "mentor_profile" (
    "member_id" UUID NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "capacity" SMALLINT NOT NULL,
    "introduction" VARCHAR(500),
    "topics" VARCHAR(160)[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mentor_profile_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "mentor_contact" (
    "id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "kind" "contact_kind" NOT NULL,
    "value" VARCHAR(500) NOT NULL,
    "visible_after_acceptance" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "mentor_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentorship" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "topic" VARCHAR(160) NOT NULL,
    "note" VARCHAR(1000) NOT NULL,
    "state" "mentorship_state" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mentorship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" UUID NOT NULL,
    "reporter_id" UUID,
    "target_type" "report_target_type" NOT NULL,
    "target_id" UUID NOT NULL,
    "target_version" INTEGER NOT NULL,
    "reason" "guideline_category" NOT NULL,
    "details" VARCHAR(1000),
    "state" "report_state" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_evidence" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "snapshot_text" TEXT,
    "image_ref" UUID,
    "purge_after" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violation" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "target_type" "report_target_type" NOT NULL,
    "target_id" UUID NOT NULL,
    "decided_by_admin_id" UUID,
    "decision_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "violation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consequence" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "violation_id" UUID NOT NULL,
    "kind" "consequence_kind" NOT NULL,
    "restrict_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_record" (
    "id" UUID NOT NULL,
    "actor_admin_id" UUID,
    "target_member_id" UUID,
    "target_admin_id" UUID,
    "action_code" "audit_action" NOT NULL,
    "reason" VARCHAR(1000),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purge_after" TIMESTAMPTZ(6),

    CONSTRAINT "audit_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "event_key" VARCHAR(200) NOT NULL,
    "actor_id" UUID,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" UUID NOT NULL,
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "organization" VARCHAR(160) NOT NULL,
    "location" VARCHAR(160) NOT NULL,
    "type" "opportunity_type" NOT NULL,
    "work_arrangement" "work_arrangement" NOT NULL,
    "description" VARCHAR(10000) NOT NULL,
    "apply_via" VARCHAR(500) NOT NULL,
    "deadline" DATE,
    "state" "opportunity_state" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, "title"), 'A') || setweight(to_tsvector('simple'::regconfig, "organization" || ' ' || "location"), 'B') || setweight(to_tsvector('simple'::regconfig, "description"), 'C')) STORED,

    CONSTRAINT "opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(10000),
    "state" "post_state" NOT NULL DEFAULT 'VISIBLE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("body", ''))) STORED,

    CONSTRAINT "post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_image" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "position" SMALLINT NOT NULL,
    "alt_text" VARCHAR(250),
    "evidence_hold" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL,
    "normalized_label" VARCHAR(30) NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_tag" (
    "post_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "post_tag_pkey" PRIMARY KEY ("post_id","tag_id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "parent_comment_id" UUID,
    "body" VARCHAR(2000),
    "state" "comment_state" NOT NULL DEFAULT 'VISIBLE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "like" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "post_id" UUID,
    "comment_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_view_day" (
    "member_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "utc_date" DATE NOT NULL,

    CONSTRAINT "post_view_day_pkey" PRIMARY KEY ("member_id","post_id","utc_date")
);

-- CreateIndex
CREATE INDEX "saved_item_target_type_target_id_idx" ON "saved_item"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "saved_item_member_id_created_at_idx" ON "saved_item"("member_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "saved_item_member_id_target_type_target_id_key" ON "saved_item"("member_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "group_state_created_at_idx" ON "group"("state", "created_at" DESC);

-- CreateIndex
CREATE INDEX "group_owner_id_idx" ON "group"("owner_id");

-- CreateIndex
CREATE INDEX "group_search_vector_idx" ON "group" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "group_membership_group_id_state_idx" ON "group_membership"("group_id", "state");

-- CreateIndex
CREATE INDEX "group_membership_member_id_state_idx" ON "group_membership"("member_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "group_membership_one_open_key" ON "group_membership"("group_id", "member_id") WHERE (state IN ('PENDING', 'ACCEPTED'));

-- CreateIndex
CREATE INDEX "group_transfer_to_member_id_state_idx" ON "group_transfer"("to_member_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "group_transfer_one_pending_key" ON "group_transfer"("group_id") WHERE ("state" = 'PENDING');

-- CreateIndex
CREATE UNIQUE INDEX "member_account_auth_user_id_key" ON "member_account"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_account_email_key" ON "member_account"("email");

-- CreateIndex
CREATE INDEX "member_account_role_alumni_status_state_idx" ON "member_account"("role", "alumni_status", "state");

-- CreateIndex
CREATE UNIQUE INDEX "profile_profile_image_id_key" ON "profile"("profile_image_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_image_storage_key_key" ON "profile_image"("storage_key");

-- CreateIndex
CREATE INDEX "profile_image_member_id_idx" ON "profile_image"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "administrator_account_auth_user_id_key" ON "administrator_account"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "administrator_account_email_key" ON "administrator_account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "administrator_account_one_first_admin_key" ON "administrator_account"("is_first_admin") WHERE ("is_first_admin" = true);

-- CreateIndex
CREATE UNIQUE INDEX "admin_session_supabase_session_id_key" ON "admin_session"("supabase_session_id");

-- CreateIndex
CREATE INDEX "admin_session_admin_id_idx" ON "admin_session"("admin_id");

-- CreateIndex
CREATE INDEX "alumni_review_decision_created_at_idx" ON "alumni_review"("decision", "created_at");

-- CreateIndex
CREATE INDEX "alumni_review_member_id_idx" ON "alumni_review"("member_id");

-- CreateIndex
CREATE INDEX "graduation_request_decision_created_at_idx" ON "graduation_request"("decision", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "graduation_request_one_pending_key" ON "graduation_request"("member_id") WHERE ("decision" = 'PENDING');

-- CreateIndex
CREATE INDEX "mentor_profile_available_idx" ON "mentor_profile"("available");

-- CreateIndex
CREATE UNIQUE INDEX "mentor_contact_mentor_id_kind_key" ON "mentor_contact"("mentor_id", "kind");

-- CreateIndex
CREATE INDEX "mentorship_mentor_id_state_idx" ON "mentorship"("mentor_id", "state");

-- CreateIndex
CREATE INDEX "mentorship_student_id_state_idx" ON "mentorship"("student_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "mentorship_one_open_per_pair_key" ON "mentorship"("student_id", "mentor_id") WHERE (state IN ('PENDING', 'ACTIVE'));

-- CreateIndex
CREATE INDEX "report_state_created_at_idx" ON "report"("state", "created_at");

-- CreateIndex
CREATE INDEX "report_target_type_target_id_idx" ON "report"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "report_reporter_id_created_at_idx" ON "report"("reporter_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "report_one_pending_key" ON "report"("reporter_id", "target_type", "target_id") WHERE ("state" = 'PENDING');

-- CreateIndex
CREATE INDEX "moderation_evidence_report_id_idx" ON "moderation_evidence"("report_id");

-- CreateIndex
CREATE INDEX "moderation_evidence_purge_after_idx" ON "moderation_evidence"("purge_after");

-- CreateIndex
CREATE INDEX "violation_member_id_idx" ON "violation"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "violation_target_type_target_id_key" ON "violation"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "consequence_violation_id_key" ON "consequence"("violation_id");

-- CreateIndex
CREATE INDEX "consequence_member_id_kind_restrict_until_idx" ON "consequence"("member_id", "kind", "restrict_until");

-- CreateIndex
CREATE INDEX "audit_record_occurred_at_idx" ON "audit_record"("occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_record_actor_admin_id_idx" ON "audit_record"("actor_admin_id");

-- CreateIndex
CREATE INDEX "audit_record_target_member_id_idx" ON "audit_record"("target_member_id");

-- CreateIndex
CREATE INDEX "audit_record_target_admin_id_idx" ON "audit_record"("target_admin_id");

-- CreateIndex
CREATE INDEX "audit_record_action_code_occurred_at_idx" ON "audit_record"("action_code", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_record_purge_after_idx" ON "audit_record"("purge_after");

-- CreateIndex
CREATE INDEX "notification_recipient_id_created_at_idx" ON "notification"("recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_unread_idx" ON "notification"("recipient_id") WHERE ("unread" = true);

-- CreateIndex
CREATE INDEX "notification_expires_at_idx" ON "notification"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipient_id_event_key_key" ON "notification"("recipient_id", "event_key");

-- CreateIndex
CREATE INDEX "opportunity_state_created_at_idx" ON "opportunity"("state", "created_at" DESC);

-- CreateIndex
CREATE INDEX "opportunity_author_id_idx" ON "opportunity"("author_id");

-- CreateIndex
CREATE INDEX "opportunity_search_vector_idx" ON "opportunity" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "post_state_created_at_idx" ON "post"("state", "created_at" DESC);

-- CreateIndex
CREATE INDEX "post_author_id_created_at_idx" ON "post"("author_id", "created_at");

-- CreateIndex
CREATE INDEX "post_search_vector_idx" ON "post" USING GIN ("search_vector");

-- CreateIndex
CREATE UNIQUE INDEX "post_image_storage_key_key" ON "post_image"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "post_image_post_id_position_key" ON "post_image"("post_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "tag_normalized_label_key" ON "tag"("normalized_label");

-- CreateIndex
CREATE INDEX "post_tag_tag_id_idx" ON "post_tag"("tag_id");

-- CreateIndex
CREATE INDEX "comment_post_id_parent_comment_id_created_at_idx" ON "comment"("post_id", "parent_comment_id", "created_at");

-- CreateIndex
CREATE INDEX "comment_author_id_idx" ON "comment"("author_id");

-- CreateIndex
CREATE INDEX "comment_created_at_idx" ON "comment"("created_at");

-- CreateIndex
CREATE INDEX "like_post_id_idx" ON "like"("post_id");

-- CreateIndex
CREATE INDEX "like_comment_id_idx" ON "like"("comment_id");

-- CreateIndex
CREATE INDEX "like_updated_at_idx" ON "like"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "like_member_id_post_id_key" ON "like"("member_id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "like_member_id_comment_id_key" ON "like"("member_id", "comment_id");

-- CreateIndex
CREATE INDEX "post_view_day_post_id_idx" ON "post_view_day"("post_id");

-- CreateIndex
CREATE INDEX "post_view_day_utc_date_idx" ON "post_view_day"("utc_date");

-- AddForeignKey
ALTER TABLE "saved_item" ADD CONSTRAINT "saved_item_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group" ADD CONSTRAINT "group_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_transfer" ADD CONSTRAINT "group_transfer_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_transfer" ADD CONSTRAINT "group_transfer_from_owner_id_fkey" FOREIGN KEY ("from_owner_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_transfer" ADD CONSTRAINT "group_transfer_to_member_id_fkey" FOREIGN KEY ("to_member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile" ADD CONSTRAINT "profile_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile" ADD CONSTRAINT "profile_profile_image_id_fkey" FOREIGN KEY ("profile_image_id") REFERENCES "profile_image"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_image" ADD CONSTRAINT "profile_image_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrator_account" ADD CONSTRAINT "administrator_account_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "administrator_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "administrator_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_email_entry" ADD CONSTRAINT "staff_email_entry_maintained_by_admin_id_fkey" FOREIGN KEY ("maintained_by_admin_id") REFERENCES "administrator_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alumni_review" ADD CONSTRAINT "alumni_review_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alumni_review" ADD CONSTRAINT "alumni_review_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "administrator_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graduation_request" ADD CONSTRAINT "graduation_request_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graduation_request" ADD CONSTRAINT "graduation_request_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "administrator_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_email_hash" ADD CONSTRAINT "blocked_email_hash_blocked_by_admin_id_fkey" FOREIGN KEY ("blocked_by_admin_id") REFERENCES "administrator_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentor_profile" ADD CONSTRAINT "mentor_profile_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentor_contact" ADD CONSTRAINT "mentor_contact_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentor_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentorship" ADD CONSTRAINT "mentorship_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentorship" ADD CONSTRAINT "mentorship_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "member_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_evidence" ADD CONSTRAINT "moderation_evidence_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_evidence" ADD CONSTRAINT "moderation_evidence_image_ref_fkey" FOREIGN KEY ("image_ref") REFERENCES "post_image"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violation" ADD CONSTRAINT "violation_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violation" ADD CONSTRAINT "violation_decided_by_admin_id_fkey" FOREIGN KEY ("decided_by_admin_id") REFERENCES "administrator_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consequence" ADD CONSTRAINT "consequence_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consequence" ADD CONSTRAINT "consequence_violation_id_fkey" FOREIGN KEY ("violation_id") REFERENCES "violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_record" ADD CONSTRAINT "audit_record_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "administrator_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_record" ADD CONSTRAINT "audit_record_target_admin_id_fkey" FOREIGN KEY ("target_admin_id") REFERENCES "administrator_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_record" ADD CONSTRAINT "audit_record_target_member_id_fkey" FOREIGN KEY ("target_member_id") REFERENCES "member_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "member_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post" ADD CONSTRAINT "post_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_image" ADD CONSTRAINT "post_image_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tag" ADD CONSTRAINT "post_tag_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tag" ADD CONSTRAINT "post_tag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "comment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "like" ADD CONSTRAINT "like_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "like" ADD CONSTRAINT "like_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "like" ADD CONSTRAINT "like_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_view_day" ADD CONSTRAINT "post_view_day_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_view_day" ADD CONSTRAINT "post_view_day_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Constraints Prisma does not model (kept by hand; see docs/STATE.md).
-- AddCheckConstraint
ALTER TABLE "member_account" ADD CONSTRAINT "member_account_email_lower_check" CHECK ("email" = lower("email"));
ALTER TABLE "member_account" ADD CONSTRAINT "member_account_alumni_status_check" CHECK (("role" = 'ALUMNI') = ("alumni_status" IS NOT NULL));
ALTER TABLE "member_account" ADD CONSTRAINT "member_account_deleted_cleared_check" CHECK ("state" <> 'DELETED' OR ("auth_user_id" IS NULL AND "email" IS NULL AND "display_name" IS NULL));
ALTER TABLE "member_account" ADD CONSTRAINT "member_account_live_identity_check" CHECK ("state" = 'DELETED' OR ("email" IS NOT NULL AND "display_name" IS NOT NULL));
ALTER TABLE "administrator_account" ADD CONSTRAINT "administrator_account_email_lower_check" CHECK ("email" = lower("email"));
ALTER TABLE "staff_email_entry" ADD CONSTRAINT "staff_email_entry_email_lower_check" CHECK ("email" = lower("email"));
ALTER TABLE "profile" ADD CONSTRAINT "profile_graduation_year_check" CHECK ("graduation_year" BETWEEN 1000 AND 9999);
ALTER TABLE "graduation_request" ADD CONSTRAINT "graduation_request_graduation_year_check" CHECK ("graduation_year" BETWEEN 1000 AND 9999);
ALTER TABLE "mentor_profile" ADD CONSTRAINT "mentor_profile_capacity_check" CHECK ("capacity" > 0);
ALTER TABLE "mentor_profile" ADD CONSTRAINT "mentor_profile_topics_check" CHECK (cardinality("topics") <= 5);
ALTER TABLE "group" ADD CONSTRAINT "group_max_occupancy_check" CHECK ("max_occupancy" > 0);
ALTER TABLE "post" ADD CONSTRAINT "post_view_count_check" CHECK ("view_count" >= 0);
ALTER TABLE "post_image" ADD CONSTRAINT "post_image_position_check" CHECK ("position" BETWEEN 1 AND 4);
ALTER TABLE "like" ADD CONSTRAINT "like_one_target_check" CHECK (num_nonnulls("post_id", "comment_id") = 1);
ALTER TABLE "consequence" ADD CONSTRAINT "consequence_restrict_until_check" CHECK (("kind" = 'RESTRICTION') = ("restrict_until" IS NOT NULL));
