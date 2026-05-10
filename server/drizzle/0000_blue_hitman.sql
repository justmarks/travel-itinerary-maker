CREATE TABLE "_phase0_scaffold" (
	"id" text PRIMARY KEY NOT NULL,
	"note" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
