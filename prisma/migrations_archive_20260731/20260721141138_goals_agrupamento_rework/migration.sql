-- AlterEnum
ALTER TYPE "GoalEngineType" ADD VALUE 'AGRUPAMENTO';

-- DropForeignKey
ALTER TABLE "goal_node_aggregates" DROP CONSTRAINT "goal_node_aggregates_companyId_fkey";

-- DropForeignKey
ALTER TABLE "goal_node_aggregates" DROP CONSTRAINT "goal_node_aggregates_goalCampaignId_fkey";

-- DropForeignKey
ALTER TABLE "goal_scope_entities" DROP CONSTRAINT "goal_scope_entities_companyId_fkey";

-- DropForeignKey
ALTER TABLE "goal_scope_entities" DROP CONSTRAINT "goal_scope_entities_goalCampaignId_fkey";

-- AlterTable
ALTER TABLE "goal_campaigns" DROP COLUMN "baseLevel";

-- AlterTable
ALTER TABLE "goal_lines" ADD COLUMN     "groupDiscountPercentage" DECIMAL(7,4);

-- DropTable
DROP TABLE "goal_node_aggregates";

-- DropTable
DROP TABLE "goal_scope_entities";

-- CreateTable
CREATE TABLE "goal_line_group_sources" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "goalLineId" TEXT NOT NULL,
    "sourceEntityType" "OrgScopeType" NOT NULL,
    "sourceEntityId" TEXT NOT NULL,

    CONSTRAINT "goal_line_group_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_line_group_sources_companyId_idx" ON "goal_line_group_sources"("companyId");

-- CreateIndex
CREATE INDEX "goal_line_group_sources_companyId_sourceEntityType_sourceEn_idx" ON "goal_line_group_sources"("companyId", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "goal_line_group_sources_goalLineId_sourceEntityType_sourceE_key" ON "goal_line_group_sources"("goalLineId", "sourceEntityType", "sourceEntityId");

-- AddForeignKey
ALTER TABLE "goal_line_group_sources" ADD CONSTRAINT "goal_line_group_sources_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_line_group_sources" ADD CONSTRAINT "goal_line_group_sources_goalLineId_fkey" FOREIGN KEY ("goalLineId") REFERENCES "goal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

