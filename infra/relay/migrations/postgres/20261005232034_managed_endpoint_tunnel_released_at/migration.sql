ALTER TABLE "relay_managed_endpoint_allocations" ADD COLUMN IF NOT EXISTS "tunnel_released_at" varchar(64);
