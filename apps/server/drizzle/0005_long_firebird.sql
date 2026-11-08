CREATE TABLE "game_data_overrides" (
	"dataset" text NOT NULL,
	"entry_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_data_overrides_pk" PRIMARY KEY("dataset","entry_id"),
	CONSTRAINT "game_data_overrides_dataset_check" CHECK ("game_data_overrides"."dataset" in ('items', 'monsters', 'dropTables', 'shops', 'spawnGroups', 'npcs', 'skills', 'stones', 'upgrades', 'bonuses'))
);
