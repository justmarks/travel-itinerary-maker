CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"capability" text NOT NULL,
	"account_email" text NOT NULL,
	"refresh_token_encrypted" text,
	"access_token_encrypted" text,
	"expires_at" timestamp with time zone,
	"scopes" text[],
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_provider_capability_email_uniq" ON "connections" USING btree ("user_id","provider","capability","account_email");--> statement-breakpoint
CREATE INDEX "connections_user_idx" ON "connections" USING btree ("user_id");