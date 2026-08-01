/*
  Warnings:

  - You are about to drop the column `fiscalYear` on the `goal_campaigns` table. All the data in the column will be lost.
  - Added the required column `endDate` to the `goal_campaigns` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startDate` to the `goal_campaigns` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "GoalLineGranularity" AS ENUM ('MENSAL', 'TRIMESTRAL', 'DIARIA');

-- AlterTable
ALTER TABLE "goal_campaigns" DROP COLUMN "fiscalYear",
ADD COLUMN     "endDate" DATE NOT NULL,
ADD COLUMN     "startDate" DATE NOT NULL;

-- AlterTable
ALTER TABLE "goal_lines" ADD COLUMN     "granularity" "GoalLineGranularity" NOT NULL DEFAULT 'MENSAL';
