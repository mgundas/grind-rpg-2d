CREATE TABLE "character_skills" (
	"character_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"rank" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_skills_pk" PRIMARY KEY("character_id","skill_id"),
	CONSTRAINT "character_skills_rank_check" CHECK ("character_skills"."rank" >= 1 AND "character_skills"."rank" <= 20)
);
--> statement-breakpoint
ALTER TABLE "character_skills" ADD CONSTRAINT "character_skills_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;