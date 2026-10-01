ALTER TABLE "relay_managed_endpoint_allocations" ADD COLUMN IF NOT EXISTS "recovery_enabled_at" varchar(64);--> statement-breakpoint
ALTER TABLE "relay_managed_endpoint_allocations" ADD COLUMN IF NOT EXISTS "recovery_environment_public_key" text;--> statement-breakpoint
ALTER TABLE "relay_managed_endpoint_allocations" ADD COLUMN IF NOT EXISTS "origin" jsonb;--> statement-breakpoint
ALTER TABLE "relay_managed_endpoint_allocations" ADD COLUMN IF NOT EXISTS "generation" integer DEFAULT 0 NOT NULL;
