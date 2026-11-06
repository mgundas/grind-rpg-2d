CREATE TABLE "admin_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_account_id" uuid,
	"target_character_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"kind" text NOT NULL,
	"interval_ms" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid,
	"name" text NOT NULL,
	"kingdom" text NOT NULL,
	"map_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_log_actor_idx" ON "admin_log" USING btree ("actor_account_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_log_target_idx" ON "admin_log" USING btree ("target_character_id","created_at");--> statement-breakpoint
CREATE INDEX "announcements_active_idx" ON "announcements" USING btree ("active","last_sent_at");--> statement-breakpoint
CREATE INDEX "chat_log_created_idx" ON "chat_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_log_character_idx" ON "chat_log" USING btree ("character_id","created_at");