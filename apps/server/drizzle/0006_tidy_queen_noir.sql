CREATE TABLE "character_skill_mastery" (
	"character_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"master_level" smallint DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_skill_mastery_pk" PRIMARY KEY("character_id","skill_id"),
	CONSTRAINT "character_skill_mastery_level_check" CHECK ("character_skill_mastery"."master_level" >= 0 AND "character_skill_mastery"."master_level" <= 10)
);
--> statement-breakpoint
CREATE TABLE "friends" (
	"character_id" uuid NOT NULL,
	"friend_character_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_pk" PRIMARY KEY("character_id","friend_character_id"),
	CONSTRAINT "friends_not_self_check" CHECK ("friends"."character_id" <> "friends"."friend_character_id")
);
--> statement-breakpoint
CREATE TABLE "guild_members" (
	"guild_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"rank" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_members_pk" PRIMARY KEY("guild_id","character_id"),
	CONSTRAINT "guild_members_rank_check" CHECK ("guild_members"."rank" in ('leader', 'officer', 'member'))
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"leader_character_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_log" ADD COLUMN "channel" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "character_skill_mastery" ADD CONSTRAINT "character_skill_mastery_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_friend_character_id_characters_id_fk" FOREIGN KEY ("friend_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_leader_character_id_characters_id_fk" FOREIGN KEY ("leader_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friends_friend_idx" ON "friends" USING btree ("friend_character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guild_members_character_uq" ON "guild_members" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guilds_name_lower_uq" ON "guilds" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_pvp_mode_check" CHECK ("characters"."pvp_mode" in ('peaceful', 'kingdom', 'free'));