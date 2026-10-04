CREATE INDEX "idx_relay_delivery_attempts_created_at" ON "relay_delivery_attempts" ("created_at");
--> statement-breakpoint
CREATE INDEX "idx_relay_environment_credentials_revoked_at" ON "relay_environment_credentials" ("revoked_at");
