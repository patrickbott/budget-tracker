CREATE TYPE "public"."account_type" AS ENUM('depository', 'credit_card', 'investment', 'loan', 'property', 'crypto', 'other_asset', 'other_liability');--> statement-breakpoint
CREATE TYPE "public"."account_visibility" AS ENUM('household', 'personal');--> statement-breakpoint
CREATE TYPE "public"."budget_mode" AS ENUM('hard_cap', 'forecast');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."budget_rollover" AS ENUM('none', 'rollover_positive', 'rollover_all');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('income', 'expense', 'transfer', 'equity');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'needs_reauth', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."depository_subtype" AS ENUM('checking', 'savings', 'money_market', 'cd');--> statement-breakpoint
CREATE TYPE "public"."entry_source" AS ENUM('simplefin', 'manual', 'import', 'rule');--> statement-breakpoint
CREATE TYPE "public"."entryable_type" AS ENUM('transaction', 'transfer', 'valuation', 'trade');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'achieved', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('savings', 'debt_payoff', 'net_worth_target');--> statement-breakpoint
CREATE TYPE "public"."insight_period" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."investment_subtype" AS ENUM('brokerage', 'ira', 'roth', '401k', '403b', 'hsa', 'other');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."recurring_cadence" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."rule_created_from" AS ENUM('manual', 'induced');--> statement-breakpoint
CREATE TYPE "public"."rule_stage" AS ENUM('pre', 'default', 'post');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('pending', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	CONSTRAINT "family_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"access_url_encrypted" text NOT NULL,
	"nickname" text,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"last_errlist" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_run_status" DEFAULT 'pending' NOT NULL,
	"request_range_start" date,
	"request_range_end" date,
	"raw_response_gzip" "bytea",
	"transactions_created" integer DEFAULT 0 NOT NULL,
	"transactions_updated" integer DEFAULT 0 NOT NULL,
	"errlist_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"visibility" "account_visibility" DEFAULT 'household' NOT NULL,
	"owner_user_id" text,
	"balance" numeric(19, 4) DEFAULT '0' NOT NULL,
	"balance_as_of" timestamp with time zone,
	"is_manual" boolean DEFAULT false NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"simplefin_account_id" text,
	"connection_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depository_account" (
	"account_id" text PRIMARY KEY NOT NULL,
	"subtype" "depository_subtype" DEFAULT 'checking' NOT NULL,
	"institution_name" text,
	"routing_number" text,
	"account_number_last4" text
);
--> statement-breakpoint
CREATE TABLE "credit_card_account" (
	"account_id" text PRIMARY KEY NOT NULL,
	"institution_name" text,
	"credit_limit" numeric(19, 4),
	"apr" numeric(7, 4),
	"statement_day" integer,
	"card_number_last4" text
);
--> statement-breakpoint
CREATE TABLE "loan_account" (
	"account_id" text PRIMARY KEY NOT NULL,
	"institution_name" text,
	"original_principal" numeric(19, 4),
	"interest_rate" numeric(7, 4),
	"term_months" integer,
	"first_payment_date" date,
	"payoff_date" date,
	"monthly_payment" numeric(19, 4)
);
--> statement-breakpoint
CREATE TABLE "investment_account" (
	"account_id" text PRIMARY KEY NOT NULL,
	"institution_name" text,
	"subtype" "investment_subtype" DEFAULT 'brokerage' NOT NULL,
	"account_number_last4" text
);
--> statement-breakpoint
CREATE TABLE "property_account" (
	"account_id" text PRIMARY KEY NOT NULL,
	"address" text,
	"purchase_date" date,
	"purchase_price" numeric(19, 4)
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"kind" "category_kind" DEFAULT 'expense' NOT NULL,
	"color" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"entryable_type" "entryable_type" DEFAULT 'transaction' NOT NULL,
	"entryable_id" text,
	"description" text NOT NULL,
	"notes" text,
	"source" "entry_source" DEFAULT 'manual' NOT NULL,
	"is_pending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_line" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text,
	"category_id" text,
	"amount" numeric(19, 4) NOT NULL,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "rule" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"stage" "rule_stage" DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"specificity_score" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_from" "rule_created_from" DEFAULT 'manual' NOT NULL,
	"conditions_json" jsonb NOT NULL,
	"actions_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"category_id" text NOT NULL,
	"period" "budget_period" DEFAULT 'monthly' NOT NULL,
	"period_start" date NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"mode" "budget_mode" DEFAULT 'hard_cap' NOT NULL,
	"rollover" "budget_rollover" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"cadence" "recurring_cadence" NOT NULL,
	"cadence_interval" integer DEFAULT 1 NOT NULL,
	"expected_amount" numeric(19, 4) NOT NULL,
	"amount_tolerance_pct" numeric(5, 4) DEFAULT '0.05' NOT NULL,
	"expected_account_id" text,
	"category_id" text,
	"last_matched_entry_id" text,
	"last_matched_date" date,
	"missing_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"goal_type" "goal_type" NOT NULL,
	"target_amount" numeric(19, 4) NOT NULL,
	"target_date" date,
	"linked_account_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"period" "insight_period" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"markdown_body" text NOT NULL,
	"tool_calls_json" jsonb,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tokens_used" numeric(12, 0) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"family_id" text NOT NULL,
	"date" date NOT NULL,
	"model" text NOT NULL,
	"input_tokens" numeric(14, 0) DEFAULT '0' NOT NULL,
	"output_tokens" numeric(14, 0) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "ai_usage_pk" PRIMARY KEY("family_id","date","model")
);
--> statement-breakpoint
CREATE TABLE "chat_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"family_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"family_id" text NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_organization_id_family_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depository_account" ADD CONSTRAINT "depository_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_account" ADD CONSTRAINT "credit_card_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_account" ADD CONSTRAINT "loan_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_account" ADD CONSTRAINT "investment_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_account" ADD CONSTRAINT "property_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_line" ADD CONSTRAINT "entry_line_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_line" ADD CONSTRAINT "entry_line_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_line" ADD CONSTRAINT "entry_line_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_expected_account_id_account_id_fk" FOREIGN KEY ("expected_account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_last_matched_entry_id_entry_id_fk" FOREIGN KEY ("last_matched_entry_id") REFERENCES "public"."entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight" ADD CONSTRAINT "insight_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversation" ADD CONSTRAINT "chat_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversation" ADD CONSTRAINT "chat_conversation_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_user_family_idx" ON "membership" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "connection_family_idx" ON "connection" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sync_run_connection_started_idx" ON "sync_run" USING btree ("connection_id","started_at");--> statement-breakpoint
CREATE INDEX "sync_run_family_idx" ON "sync_run" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "account_family_type_idx" ON "account" USING btree ("family_id","account_type");--> statement-breakpoint
CREATE UNIQUE INDEX "account_connection_simplefin_idx" ON "account" USING btree ("connection_id","simplefin_account_id") WHERE "account"."simplefin_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "category_family_idx" ON "category" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "category_parent_idx" ON "category" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "entry_family_date_idx" ON "entry" USING btree ("family_id","entry_date");--> statement-breakpoint
CREATE INDEX "entry_line_entry_idx" ON "entry_line" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_line_category_idx" ON "entry_line" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "entry_line_account_idx" ON "entry_line" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "rule_family_stage_idx" ON "rule" USING btree ("family_id","stage","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_family_category_period_idx" ON "budget" USING btree ("family_id","category_id","period","period_start");--> statement-breakpoint
CREATE INDEX "budget_family_period_start_idx" ON "budget" USING btree ("family_id","period_start");--> statement-breakpoint
CREATE INDEX "recurring_family_idx" ON "recurring" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "goal_family_idx" ON "goal" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "insight_family_period_idx" ON "insight" USING btree ("family_id","period","period_start");--> statement-breakpoint
CREATE INDEX "chat_conversation_user_idx" ON "chat_conversation" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "chat_conversation_family_idx" ON "chat_conversation" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "chat_message_conversation_idx" ON "chat_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_message_family_idx" ON "chat_message" USING btree ("family_id");