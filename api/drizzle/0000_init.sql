CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."absence_state" AS ENUM('REPORTED', 'REQUESTED', 'APPROVED', 'REJECTED', 'CANCEL_REQUESTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."absence_type" AS ENUM('KRANK', 'URLAUB');--> statement-breakpoint
CREATE TYPE "public"."activity" AS ENUM('WORK', 'TRAVEL', 'DIAGNOSIS');--> statement-breakpoint
CREATE TYPE "public"."app_status" AS ENUM('NEU', 'EINGEPLANT', 'UNTERWEGS', 'IN_ARBEIT', 'WARTET_TEILE', 'WARTET_KUNDE', 'FERTIG_DOKU_OFFEN', 'FERTIG', 'FREIGEGEBEN', 'ABGERECHNET');--> statement-breakpoint
CREATE TYPE "public"."approval_state" AS ENUM('OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'TRANSFERRED');--> statement-breakpoint
CREATE TYPE "public"."bc_status" AS ENUM('Pending', 'In Process', 'Finished', 'On Hold');--> statement-breakpoint
CREATE TYPE "public"."container_kind" AS ENUM('FASS', 'IBC', 'TANK', 'KANISTER', 'KARTUSCHE');--> statement-breakpoint
CREATE TYPE "public"."half_day" AS ENUM('NONE', 'AM', 'PM');--> statement-breakpoint
CREATE TYPE "public"."location_role" AS ENUM('MONTEUR', 'MEISTER', 'LAGER');--> statement-breakpoint
CREATE TYPE "public"."part_request_state" AS ENUM('OFFEN', 'BESTELLT', 'GELIEFERT', 'STORNIERT');--> statement-breakpoint
CREATE TYPE "public"."photo_category" AS ENUM('VORHER', 'NACHHER', 'TYPENSCHILD', 'BSZ', 'TEIL', 'SONSTIGES');--> statement-breakpoint
CREATE TYPE "public"."productivity_category" AS ENUM('KUNDENSERVICE', 'WARTUNG_KUNDE', 'WARTUNG_INTERN', 'GARANTIE_KULANZ', 'INTERN_SONSTIGE', 'NACHARBEIT');--> statement-breakpoint
CREATE TYPE "public"."stamp_kind" AS ENUM('CLOCK_IN', 'CLOCK_OUT', 'JOB_START', 'JOB_PAUSE', 'JOB_STOP', 'OVERHEAD_START', 'OVERHEAD_STOP', 'BREAK_START', 'BREAK_STOP');--> statement-breakpoint
CREATE TYPE "public"."storage_kind" AS ENUM('LAGER', 'SERVICEWAGEN', 'TANK');--> statement-breakpoint
CREATE TYPE "public"."time_entry_kind" AS ENUM('ATTENDANCE', 'ORDER', 'OVERHEAD', 'BREAK');--> statement-breakpoint
CREATE TYPE "public"."transfer_state" AS ENUM('PENDING', 'IN_PROGRESS', 'DONE', 'FAILED', 'DEAD');--> statement-breakpoint
CREATE TYPE "public"."transfer_target" AS ENUM('SERVICE_LINE_RESOURCE', 'SERVICE_LINE_ITEM', 'RESOURCE_JOURNAL', 'ITEM_JOURNAL', 'ALLOCATION', 'COMMENT', 'ABSENCE', 'STATUS');--> statement-breakpoint
CREATE TYPE "public"."upload_state" AS ENUM('PENDING', 'UPLOADED', 'FAILED');--> statement-breakpoint
CREATE TABLE "absence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"type" "absence_type" NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"half_day" "half_day" DEFAULT 'NONE' NOT NULL,
	"state" "absence_state" NOT NULL,
	"comment" text,
	"decision_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_oid" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"is_apprentice" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "app_user_entra_oid_unique" UNIQUE("entra_oid")
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_line_no" integer DEFAULT 10000 NOT NULL,
	"location_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"planned_start" timestamp with time zone NOT NULL,
	"planned_end" timestamp with time zone NOT NULL,
	"conflict_state" text DEFAULT 'ok' NOT NULL,
	"needs_replan" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"bc_allocation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bc_resource_mapping" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"bc_resource_no" text NOT NULL,
	"bc_employee_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bc_sync_cursor" (
	"bc_company_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"last_modified" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "bc_sync_cursor_bc_company_id_entity_pk" PRIMARY KEY("bc_company_id","entity")
);
--> statement-breakpoint
CREATE TABLE "bc_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid,
	"bc_company_id" uuid NOT NULL,
	"target" "transfer_target" NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" "transfer_state" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"bc_record_id" uuid,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"author_id" uuid,
	"server_seq" bigserial NOT NULL,
	"client_seq" integer,
	"client_created_at" timestamp with time zone,
	"body" text NOT NULL,
	"photo_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_read" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_read_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "consumption" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"order_id" uuid,
	"item_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"container_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" text NOT NULL,
	"cost_center" text,
	"internal_purpose" text,
	"meter_before" numeric(14, 3),
	"meter_after" numeric(14, 3),
	"device_time" timestamp with time zone NOT NULL,
	"state" "approval_state" DEFAULT 'SUBMITTED' NOT NULL,
	"bc_posted_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"stock_conflict" boolean DEFAULT false NOT NULL,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "container_kind" NOT NULL,
	"name" text NOT NULL,
	"capacity" numeric(14, 3),
	"min_stock" numeric(14, 3),
	"has_meter" boolean DEFAULT false NOT NULL,
	"quick_quantities" jsonb DEFAULT '[5,10,20,40]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"post_code" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"location_id" uuid,
	"feature" text NOT NULL,
	"enabled" boolean NOT NULL,
	"changed_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"gtin" text DEFAULT '' NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"is_consumable" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_barcode" (
	"item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_barcode_item_id_code_pk" PRIMARY KEY("item_id","code")
);
--> statement-breakpoint
CREATE TABLE "item_stock" (
	"item_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"bc_inventory" numeric(14, 3) DEFAULT 0 NOT NULL,
	"pending_withdrawal" numeric(14, 3) DEFAULT 0 NOT NULL,
	"min_stock" numeric(14, 3),
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "item_stock_item_id_storage_location_id_pk" PRIMARY KEY("item_id","storage_location_id")
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"bundesland" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"bc_responsibility_center" text NOT NULL,
	"default_location_code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "location_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "machine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"service_item_no" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"serial_no" text DEFAULT '' NOT NULL,
	"machine_group" text DEFAULT '' NOT NULL,
	"operating_hours" numeric(10, 1),
	"customer_no" text DEFAULT '' NOT NULL,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "app_status",
	"to_status" "app_status" NOT NULL,
	"actor_id" uuid,
	"source" text NOT NULL,
	"note" text,
	"device_time" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_type_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_type_code" text NOT NULL,
	"category" "productivity_category" NOT NULL,
	"productive" boolean NOT NULL,
	"external" boolean NOT NULL,
	"valid_from" date NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overhead_type" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"counts_as_attendance" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"item_id" uuid,
	"new_item_text" text,
	"manufacturer_part_no" text,
	"quantity" numeric(14, 3) NOT NULL,
	"source_bc_location_code" text,
	"expected_delivery" date,
	"state" "part_request_state" DEFAULT 'OFFEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"category" "photo_category" NOT NULL,
	"blob_path" text NOT NULL,
	"content_type" text DEFAULT 'image/jpeg' NOT NULL,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"captured_at" timestamp with time zone,
	"upload_state" "upload_state" DEFAULT 'PENDING' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "productivity_snapshot" (
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"location_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"mapping_version" text NOT NULL,
	"config_hash" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "productivity_snapshot_user_id_month_pk" PRIMARY KEY("user_id","month")
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "service_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"bc_no" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"order_type_code" text NOT NULL,
	"bc_status" "bc_status" NOT NULL,
	"app_status" "app_status" DEFAULT 'NEU' NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"order_date" date,
	"response_date" date,
	"customer_no" text DEFAULT '' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"address" jsonb,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"contact_mobile" text DEFAULT '' NOT NULL,
	"fault_description" text DEFAULT '' NOT NULL,
	"rework_flag" boolean DEFAULT false NOT NULL,
	"billed_at" timestamp with time zone,
	"deleted_in_bc_at" timestamp with time zone,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"machine_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"fault_comment" text DEFAULT '' NOT NULL,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stamp_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "stamp_kind" NOT NULL,
	"order_id" uuid,
	"activity" "activity",
	"overhead_code" text,
	"device_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_skew_ms" integer,
	"skew_flag" boolean DEFAULT false NOT NULL,
	"implicit" boolean DEFAULT false NOT NULL,
	"device_id" text,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"bc_location_code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "storage_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_command" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"device_seq" integer NOT NULL,
	"type" text NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"result_detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "text_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid,
	"order_type_code" text,
	"machine_group" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" time_entry_kind NOT NULL,
	"order_id" uuid,
	"activity" "activity",
	"overhead_code" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"actual_minutes" integer,
	"billable_minutes" integer,
	"state" "approval_state" DEFAULT 'OPEN' NOT NULL,
	"needs_correction" boolean DEFAULT false NOT NULL,
	"skew_flag" boolean DEFAULT false NOT NULL,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"old_value" jsonb NOT NULL,
	"new_value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"changed_by" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_location" (
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"role" "location_role" NOT NULL,
	"service_van_storage_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_location_user_id_location_id_role_pk" PRIMARY KEY("user_id","location_id","role")
);
--> statement-breakpoint
CREATE TABLE "vacation_balance" (
	"user_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"entitlement_days" numeric(5, 1) NOT NULL,
	"carry_over_days" numeric(5, 1) DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'APP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "vacation_balance_user_id_year_pk" PRIMARY KEY("user_id","year")
);
--> statement-breakpoint
CREATE TABLE "work_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"required_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"used_template_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"device_time" timestamp with time zone,
	"state" "approval_state" DEFAULT 'OPEN' NOT NULL,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "work_report_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bc_resource_mapping" ADD CONSTRAINT "bc_resource_mapping_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bc_transfer" ADD CONSTRAINT "bc_transfer_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_read" ADD CONSTRAINT "chat_read_message_id_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_read" ADD CONSTRAINT "chat_read_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption" ADD CONSTRAINT "consumption_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption" ADD CONSTRAINT "consumption_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption" ADD CONSTRAINT "consumption_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption" ADD CONSTRAINT "consumption_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption" ADD CONSTRAINT "consumption_storage_location_id_storage_location_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption" ADD CONSTRAINT "consumption_container_id_container_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."container"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container" ADD CONSTRAINT "container_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container" ADD CONSTRAINT "container_storage_location_id_storage_location_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container" ADD CONSTRAINT "container_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_changed_by_app_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcode" ADD CONSTRAINT "item_barcode_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_stock" ADD CONSTRAINT "item_stock_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_stock" ADD CONSTRAINT "item_stock_storage_location_id_storage_location_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_event" ADD CONSTRAINT "order_status_event_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_event" ADD CONSTRAINT "order_status_event_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_type_mapping" ADD CONSTRAINT "order_type_mapping_changed_by_app_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_request" ADD CONSTRAINT "part_request_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_request" ADD CONSTRAINT "part_request_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_request" ADD CONSTRAINT "part_request_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_request" ADD CONSTRAINT "part_request_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productivity_snapshot" ADD CONSTRAINT "productivity_snapshot_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productivity_snapshot" ADD CONSTRAINT "productivity_snapshot_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_item" ADD CONSTRAINT "service_order_item_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_item" ADD CONSTRAINT "service_order_item_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting" ADD CONSTRAINT "setting_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_event" ADD CONSTRAINT "stamp_event_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_event" ADD CONSTRAINT "stamp_event_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_event" ADD CONSTRAINT "stamp_event_overhead_code_overhead_type_code_fk" FOREIGN KEY ("overhead_code") REFERENCES "public"."overhead_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_location" ADD CONSTRAINT "storage_location_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_command" ADD CONSTRAINT "sync_command_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_template" ADD CONSTRAINT "text_template_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_overhead_code_overhead_type_code_fk" FOREIGN KEY ("overhead_code") REFERENCES "public"."overhead_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_revision" ADD CONSTRAINT "time_entry_revision_time_entry_id_time_entry_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_revision" ADD CONSTRAINT "time_entry_revision_changed_by_app_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_location" ADD CONSTRAINT "user_location_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_location" ADD CONSTRAINT "user_location_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_location" ADD CONSTRAINT "user_location_service_van_storage_id_storage_location_id_fk" FOREIGN KEY ("service_van_storage_id") REFERENCES "public"."storage_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_balance" ADD CONSTRAINT "vacation_balance_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_report" ADD CONSTRAINT "work_report_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_report" ADD CONSTRAINT "work_report_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_user_idx" ON "absence" USING btree ("user_id","from_date");--> statement-breakpoint
CREATE INDEX "absence_location_idx" ON "absence" USING btree ("location_id","from_date");--> statement-breakpoint
CREATE INDEX "assignment_user_idx" ON "assignment" USING btree ("user_id","planned_start");--> statement-breakpoint
CREATE INDEX "assignment_order_idx" ON "assignment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bc_resource_mapping_res_uq" ON "bc_resource_mapping" USING btree ("bc_company_id","bc_resource_no");--> statement-breakpoint
CREATE INDEX "bc_transfer_due_idx" ON "bc_transfer" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "bc_transfer_subject_idx" ON "bc_transfer" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "chat_message_order_idx" ON "chat_message" USING btree ("order_id","server_seq");--> statement-breakpoint
CREATE INDEX "consumption_order_idx" ON "consumption" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_no_uq" ON "customer" USING btree ("bc_company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flag_uq" ON "feature_flag" USING btree (coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid),"feature");--> statement-breakpoint
CREATE UNIQUE INDEX "item_no_uq" ON "item" USING btree ("bc_company_id","number");--> statement-breakpoint
CREATE INDEX "item_gtin_idx" ON "item" USING btree ("gtin");--> statement-breakpoint
CREATE INDEX "item_name_trgm_idx" ON "item" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "item_barcode_code_idx" ON "item_barcode" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "machine_no_uq" ON "machine" USING btree ("bc_company_id","service_item_no");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "order_status_event_order_idx" ON "order_status_event" USING btree ("order_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_type_uq" ON "order_type" USING btree ("bc_company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "order_type_mapping_uq" ON "order_type_mapping" USING btree ("order_type_code","valid_from");--> statement-breakpoint
CREATE INDEX "photo_order_idx" ON "photo" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_no_uq" ON "service_order" USING btree ("bc_company_id","bc_no");--> statement-breakpoint
CREATE INDEX "service_order_location_idx" ON "service_order" USING btree ("location_id","app_status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_item_uq" ON "service_order_item" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_uq" ON "setting" USING btree (coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid),"key");--> statement-breakpoint
CREATE INDEX "stamp_event_user_idx" ON "stamp_event" USING btree ("user_id","device_time");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_location_code_uq" ON "storage_location" USING btree ("location_id","bc_location_code");--> statement-breakpoint
CREATE INDEX "sync_command_user_idx" ON "sync_command" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "time_entry_user_date_idx" ON "time_entry" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE INDEX "time_entry_order_idx" ON "time_entry" USING btree ("order_id");