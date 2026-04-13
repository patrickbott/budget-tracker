CREATE TYPE "public"."coaching_alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."coaching_alert_type" AS ENUM('budget_pace', 'recurring_late', 'goal_risk', 'general');--> statement-breakpoint
CREATE TABLE "coaching_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"alert_type" "coaching_alert_type" NOT NULL,
	"severity" "coaching_alert_severity" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"tokens_used" numeric(12, 0) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coaching_alert" ADD CONSTRAINT "coaching_alert_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coaching_alert_family_active_idx" ON "coaching_alert" USING btree ("family_id","dismissed","expires_at");
