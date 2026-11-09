ALTER TABLE "ai_tasks" ADD COLUMN "progress" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "ai_tasks_section_status_updatedAt_idx" ON "ai_tasks"("section", "status", "updatedAt");
