CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"kingdom" text NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"banned_until" timestamp with time zone,
	"ban_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"class_id" text NOT NULL,
	"doctrine" text,
	"gender" text NOT NULL,
	"hair_style" smallint NOT NULL,
	"hair_color" smallint NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"gold" bigint DEFAULT 0 NOT NULL,
	"hp" integer NOT NULL,
	"mp" integer NOT NULL,
	"stat_vit" integer NOT NULL,
	"stat_int" integer NOT NULL,
	"stat_str" integer NOT NULL,
	"stat_dex" integer NOT NULL,
	"stat_points" integer DEFAULT 0 NOT NULL,
	"skill_points" integer DEFAULT 0 NOT NULL,
	"map_id" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"channel" integer DEFAULT 1 NOT NULL,
	"pvp_mode" text DEFAULT 'peaceful' NOT NULL,
	"playtime_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_lower_uq" ON "accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username_lower_uq" ON "accounts" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "characters_name_lower_uq" ON "characters" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "characters_account_idx" ON "characters" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");