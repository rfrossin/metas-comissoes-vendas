-- DropIndex
DROP INDEX "goal_lines_goalCampaignId_entityType_entityId_key";

-- AlterTable
ALTER TABLE "goal_campaigns" ADD COLUMN     "inactivatedAt" DATE;

-- AlterTable
ALTER TABLE "goal_lines" ADD COLUMN     "inactivatedAt" DATE,
ADD COLUMN     "recalculatedFromLineId" TEXT;

-- CreateIndex
CREATE INDEX "goal_lines_goalCampaignId_entityType_entityId_idx" ON "goal_lines"("goalCampaignId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "goal_lines" ADD CONSTRAINT "goal_lines_recalculatedFromLineId_fkey" FOREIGN KEY ("recalculatedFromLineId") REFERENCES "goal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
