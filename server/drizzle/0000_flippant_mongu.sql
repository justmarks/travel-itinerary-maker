CREATE TABLE "processed_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"account_email" text DEFAULT '' NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text,
	"subject" text,
	"from_address" text,
	"received_at" timestamp with time zone,
	"parsed_type" text,
	"segment_id" text,
	"trip_id" text,
	"parse_status" text NOT NULL,
	"parse_error" text,
	"parsed_result" jsonb,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"day_date" date NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"end_date" date,
	"city" text,
	"source" text NOT NULL,
	"source_email_id" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"calendar_event_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_email" text,
	"shared_with_email" text NOT NULL,
	"permission" text NOT NULL,
	"show_costs" boolean DEFAULT true NOT NULL,
	"show_todos" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"text" text NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"category" text,
	"details" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_history" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"actor_email" text NOT NULL,
	"actor_name" text,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"details" text,
	"entity_id" text
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text NOT NULL,
	"calendar_id" text,
	"schema_version" integer DEFAULT 2 NOT NULL,
	"day_cities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shares" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"gmail_label_filter" text,
	"email_scan_interval_minutes" integer DEFAULT 1440 NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processed_emails" ADD CONSTRAINT "processed_emails_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_history" ADD CONSTRAINT "trip_history_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "processed_emails_msg_uniq" ON "processed_emails" USING btree ("user_id","provider","account_email","message_id");--> statement-breakpoint
CREATE INDEX "processed_emails_user_created_idx" ON "processed_emails" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "segments_trip_day_order_idx" ON "segments" USING btree ("trip_id","day_date","sort_order");--> statement-breakpoint
CREATE INDEX "share_rules_owner_created_idx" ON "share_rules" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "share_rules_owner_recipient_uniq" ON "share_rules" USING btree ("owner_user_id","shared_with_email");--> statement-breakpoint
CREATE INDEX "todos_trip_order_idx" ON "todos" USING btree ("trip_id","sort_order");--> statement-breakpoint
CREATE INDEX "trip_history_trip_ts_idx" ON "trip_history" USING btree ("trip_id","ts");--> statement-breakpoint
CREATE INDEX "trips_user_start_date_idx" ON "trips" USING btree ("user_id","start_date");