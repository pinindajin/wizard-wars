-- Add app-admin flag to users. Existing users remain non-admin by default.
ALTER TABLE "users" ADD COLUMN "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- Singleton app-level runtime configuration. Missing row means "all defaults".
CREATE TABLE "app_config" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "log_level" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("id")
);
