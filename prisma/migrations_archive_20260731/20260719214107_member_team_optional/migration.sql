-- DropForeignKey
ALTER TABLE "members" DROP CONSTRAINT "members_teamId_fkey";

-- AlterTable
ALTER TABLE "members" ALTER COLUMN "teamId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
