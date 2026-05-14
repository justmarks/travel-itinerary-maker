CREATE TABLE "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trip_shares" (
	"share_token" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_email" text,
	"shared_with_email" text,
	"permission" text NOT NULL,
	"show_costs" boolean DEFAULT true NOT NULL,
	"show_todos" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_shares" ADD CONSTRAINT "trip_shares_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_email_idx" ON "push_subscriptions" USING btree ("email");--> statement-breakpoint
CREATE INDEX "trip_shares_email_idx" ON "trip_shares" USING btree ("shared_with_email");--> statement-breakpoint
CREATE INDEX "trip_shares_trip_idx" ON "trip_shares" USING btree ("trip_id");