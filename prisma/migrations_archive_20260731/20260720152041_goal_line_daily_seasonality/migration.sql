-- AlterTable
ALTER TABLE "goal_lines" ADD COLUMN     "dailySeasonalityBaseId" TEXT;

-- AddForeignKey
ALTER TABLE "goal_lines" ADD CONSTRAINT "goal_lines_dailySeasonalityBaseId_fkey" FOREIGN KEY ("dailySeasonalityBaseId") REFERENCES "seasonality_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
