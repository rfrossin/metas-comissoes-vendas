-- AlterTable
ALTER TABLE "goal_lines" DROP COLUMN "granularity";

-- DropEnum
DROP TYPE "GoalLineGranularity";
