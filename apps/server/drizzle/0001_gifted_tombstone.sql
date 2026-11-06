CREATE TABLE "gold_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"account_id" uuid,
	"delta" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reason" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"actor_character_id" uuid,
	"account_id" uuid,
	"action" text NOT NULL,
	"definition_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"from_location" text,
	"from_slot" integer,
	"to_location" text,
	"to_slot" integer,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"definition_id" text NOT NULL,
	"owner_character_id" uuid,
	"owner_account_id" uuid,
	"location" text NOT NULL,
	"slot" integer,
	"quantity" integer DEFAULT 1 NOT NULL,
	"upgrade_level" smallint DEFAULT 0 NOT NULL,
	"bonuses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"map_id" text,
	"room_id" text,
	"x" real,
	"y" real,
	"drop_owner_character_id" uuid,
	"owner_until" timestamp with time zone,
	"despawn_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_owner_character_id_characters_id_fk" FOREIGN KEY ("owner_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gold_log_character_idx" ON "gold_log" USING btree ("character_id","created_at");--> statement-breakpoint
CREATE INDEX "item_log_item_idx" ON "item_log" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "item_log_character_idx" ON "item_log" USING btree ("actor_character_id","created_at");--> statement-breakpoint
CREATE INDEX "items_character_idx" ON "items" USING btree ("owner_character_id","location");--> statement-breakpoint
CREATE INDEX "items_account_idx" ON "items" USING btree ("owner_account_id","location");--> statement-breakpoint
CREATE INDEX "items_ground_idx" ON "items" USING btree ("map_id","despawn_at");--> statement-breakpoint
CREATE UNIQUE INDEX "items_inventory_slot_uq" ON "items" USING btree ("owner_character_id","slot") WHERE "items"."location" = 'inventory';--> statement-breakpoint
CREATE UNIQUE INDEX "items_equipment_slot_uq" ON "items" USING btree ("owner_character_id","slot") WHERE "items"."location" = 'equipment';--> statement-breakpoint
CREATE UNIQUE INDEX "items_warehouse_slot_uq" ON "items" USING btree ("owner_account_id","slot") WHERE "items"."location" = 'warehouse';