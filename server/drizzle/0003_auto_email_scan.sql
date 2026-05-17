CREATE TABLE "email_scan_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"label_filter" text,
	"label_name" text,
	"frequency" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_scan_schedules_user_idx" ON "email_scan_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_scan_schedules_due_idx" ON "email_scan_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE TABLE "email_scan_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"scanned_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "email_scan_runs_schedule_idx" ON "email_scan_runs" USING btree ("schedule_id","started_at");--> statement-breakpoint
ALTER TABLE "email_scan_runs" ADD CONSTRAINT "email_scan_runs_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."email_scan_schedules"("id") ON DELETE cascade;
