-- CreateEnum
CREATE TYPE "SignupRequestStatus" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO');

-- AlterTable
ALTER TABLE "platform_users" ADD COLUMN     "authUserId" TEXT;

-- CreateTable
CREATE TABLE "company_signup_requests" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "status" "SignupRequestStatus" NOT NULL DEFAULT 'PENDENTE',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdCompanyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_signup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_signup_requests_status_idx" ON "company_signup_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_authUserId_key" ON "platform_users"("authUserId");

-- AddForeignKey
ALTER TABLE "company_signup_requests" ADD CONSTRAINT "company_signup_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

