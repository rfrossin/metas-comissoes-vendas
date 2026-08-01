-- DropIndex
DROP INDEX "goal_line_group_sources_companyId_sourceEntityType_sourceEn_idx";

-- DropIndex
DROP INDEX "goal_line_group_sources_goalLineId_sourceEntityType_sourceE_key";

-- AlterTable (nullable primeiro: backfill roda antes do NOT NULL, já que
-- toda origem existente hoje é implicitamente da mesma campanha da sua
-- Linha Agrupada dona).
ALTER TABLE "goal_line_group_sources" ADD COLUMN     "sourceGoalCampaignId" TEXT;

UPDATE "goal_line_group_sources" AS gs
SET "sourceGoalCampaignId" = gl."goalCampaignId"
FROM "goal_lines" AS gl
WHERE gl.id = gs."goalLineId";

ALTER TABLE "goal_line_group_sources" ALTER COLUMN "sourceGoalCampaignId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "goal_line_group_sources_companyId_sourceGoalCampaignId_sour_idx" ON "goal_line_group_sources"("companyId", "sourceGoalCampaignId", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "goal_line_group_sources_goalLineId_sourceGoalCampaignId_sou_key" ON "goal_line_group_sources"("goalLineId", "sourceGoalCampaignId", "sourceEntityType", "sourceEntityId");
