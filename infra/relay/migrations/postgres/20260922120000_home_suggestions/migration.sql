CREATE TABLE "relay_home_suggestion_digests" (
	"user_id" varchar(191),
	"environment_id" varchar(191),
	"digest_json" jsonb NOT NULL,
	"updated_at" varchar(64) NOT NULL,
	CONSTRAINT "relay_home_suggestion_digests_pkey" PRIMARY KEY("user_id","environment_id")
);
--> statement-breakpoint
CREATE TABLE "relay_home_suggestions" (
	"user_id" varchar(191) PRIMARY KEY,
	"batch_json" jsonb,
	"generated_at" varchar(64),
	"lease_environment_id" varchar(191),
	"lease_expires_at" varchar(64),
	"created_at" varchar(64) NOT NULL,
	"updated_at" varchar(64) NOT NULL
);
