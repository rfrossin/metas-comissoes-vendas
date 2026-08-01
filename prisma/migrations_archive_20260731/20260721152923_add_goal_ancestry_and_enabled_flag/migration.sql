-- AlterTable
ALTER TABLE "goal_lines" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "memberId" TEXT,
ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "goal_node_aggregates" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "enabledForAcompanhamento" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "memberId" TEXT,
ADD COLUMN     "teamId" TEXT;

-- CreateIndex
CREATE INDEX "goal_lines_companyId_channelId_idx" ON "goal_lines"("companyId", "channelId");

-- CreateIndex
CREATE INDEX "goal_lines_companyId_departmentId_idx" ON "goal_lines"("companyId", "departmentId");

-- CreateIndex
CREATE INDEX "goal_lines_companyId_teamId_idx" ON "goal_lines"("companyId", "teamId");

-- CreateIndex
CREATE INDEX "goal_lines_companyId_memberId_idx" ON "goal_lines"("companyId", "memberId");

-- CreateIndex
CREATE INDEX "goal_node_aggregates_companyId_channelId_idx" ON "goal_node_aggregates"("companyId", "channelId");

-- CreateIndex
CREATE INDEX "goal_node_aggregates_companyId_departmentId_idx" ON "goal_node_aggregates"("companyId", "departmentId");

-- CreateIndex
CREATE INDEX "goal_node_aggregates_companyId_teamId_idx" ON "goal_node_aggregates"("companyId", "teamId");

-- CreateIndex
CREATE INDEX "goal_node_aggregates_companyId_memberId_idx" ON "goal_node_aggregates"("companyId", "memberId");
