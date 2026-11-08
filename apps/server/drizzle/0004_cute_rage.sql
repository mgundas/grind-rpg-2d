CREATE TABLE "trade_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"map_id" text NOT NULL,
	"character_a_id" uuid NOT NULL,
	"account_a_id" uuid NOT NULL,
	"character_b_id" uuid NOT NULL,
	"account_b_id" uuid NOT NULL,
	"gold_a" bigint NOT NULL,
	"gold_b" bigint NOT NULL,
	"items_a" jsonb NOT NULL,
	"items_b" jsonb NOT NULL,
	"result" text DEFAULT 'completed' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trade_log_a_idx" ON "trade_log" USING btree ("character_a_id","created_at");--> statement-breakpoint
CREATE INDEX "trade_log_b_idx" ON "trade_log" USING btree ("character_b_id","created_at");--> statement-breakpoint
CREATE INDEX "trade_log_created_idx" ON "trade_log" USING btree ("created_at");