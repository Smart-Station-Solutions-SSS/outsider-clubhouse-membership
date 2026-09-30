-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('AUTO', 'ADMIN');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('MATCHED', 'MISMATCH_FLAGGED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VisitKind" AS ENUM ('DAY_USE', 'GUEST');

-- CreateEnum
CREATE TYPE "VisitRequestStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('PENDING_REVIEW', 'PENDING_PAYMENT', 'ACTIVE', 'USED', 'EXPIRED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HostKind" AS ENUM ('MEMBER', 'SSS_RESIDENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ApiKeyKind" AS ENUM ('ADMIN', 'PARTNER');

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sssCommunityId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "membershipApproval" "ApprovalMode" NOT NULL DEFAULT 'ADMIN',
    "dayUseApproval" "ApprovalMode" NOT NULL DEFAULT 'ADMIN',
    "guestDiscountPercent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgeBand" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minAge" INTEGER NOT NULL,
    "maxAge" INTEGER,

    CONSTRAINT "AgeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "termMonths" INTEGER NOT NULL,
    "guestsPerDay" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanPrice" (
    "planId" TEXT NOT NULL,
    "ageBandId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PlanPrice_pkey" PRIMARY KEY ("planId","ageBandId")
);

-- CreateTable
CREATE TABLE "DayUseFee" (
    "clubId" TEXT NOT NULL,
    "ageBandId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "DayUseFee_pkey" PRIMARY KEY ("clubId","ageBandId")
);

-- CreateTable
CREATE TABLE "IdCheck" (
    "id" TEXT NOT NULL,
    "nationalIdHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "imagePath" TEXT,
    "ocrName" TEXT,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nationalIdEnc" TEXT NOT NULL,
    "nationalIdHash" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "idImagePath" TEXT,
    "ocrStatus" "OcrStatus" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "ageBandId" TEXT NOT NULL,
    "ageAtPurchase" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startsAt" DATE,
    "endsAt" DATE,
    "cardNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitRequest" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "kind" "VisitKind" NOT NULL,
    "status" "VisitRequestStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "visitDate" DATE NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT NOT NULL,
    "accessTokenHash" TEXT,
    "hostKind" "HostKind",
    "hostMemberId" TEXT,
    "hostSssResidentId" TEXT,
    "hostSssName" TEXT,
    "ocrStatus" "OcrStatus",
    "idImagePath" TEXT,
    "total" DECIMAL(10,2) NOT NULL,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pass" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "VisitKind" NOT NULL,
    "visitDate" DATE NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "nationalIdEnc" TEXT NOT NULL,
    "nationalIdHash" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "ageBandId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "status" "PassStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "qrToken" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "membershipId" TEXT,
    "visitRequestId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'PAYMOB',
    "providerOrderId" TEXT,
    "providerTransactionId" TEXT,
    "checkoutUrl" TEXT,
    "failureReason" TEXT,
    "rawRequest" JSONB,
    "rawCallback" JSONB,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLedger" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ApiKeyKind" NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Club_sssCommunityId_key" ON "Club"("sssCommunityId");

-- CreateIndex
CREATE INDEX "AgeBand_clubId_idx" ON "AgeBand"("clubId");

-- CreateIndex
CREATE INDEX "Plan_clubId_idx" ON "Plan"("clubId");

-- CreateIndex
CREATE INDEX "IdCheck_nationalIdHash_idx" ON "IdCheck"("nationalIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "Member_email_key" ON "Member"("email");

-- CreateIndex
CREATE INDEX "Member_clubId_status_idx" ON "Member"("clubId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Member_clubId_nationalIdHash_key" ON "Member"("clubId", "nationalIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_cardNumber_key" ON "Membership"("cardNumber");

-- CreateIndex
CREATE INDEX "Membership_memberId_status_idx" ON "Membership"("memberId", "status");

-- CreateIndex
CREATE INDEX "VisitRequest_clubId_status_idx" ON "VisitRequest"("clubId", "status");

-- CreateIndex
CREATE INDEX "VisitRequest_hostMemberId_visitDate_idx" ON "VisitRequest"("hostMemberId", "visitDate");

-- CreateIndex
CREATE INDEX "VisitRequest_hostSssResidentId_visitDate_idx" ON "VisitRequest"("hostSssResidentId", "visitDate");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_qrToken_key" ON "Pass"("qrToken");

-- CreateIndex
CREATE INDEX "Pass_requestId_idx" ON "Pass"("requestId");

-- CreateIndex
CREATE INDEX "Pass_visitDate_status_idx" ON "Pass"("visitDate", "status");

-- CreateIndex
CREATE INDEX "Payment_membershipId_idx" ON "Payment"("membershipId");

-- CreateIndex
CREATE INDEX "Payment_visitRequestId_idx" ON "Payment"("visitRequestId");

-- CreateIndex
CREATE INDEX "Payment_providerOrderId_idx" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookLedger_provider_transactionId_key" ON "WebhookLedger"("provider", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- AddForeignKey
ALTER TABLE "AgeBand" ADD CONSTRAINT "AgeBand_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_ageBandId_fkey" FOREIGN KEY ("ageBandId") REFERENCES "AgeBand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayUseFee" ADD CONSTRAINT "DayUseFee_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayUseFee" ADD CONSTRAINT "DayUseFee_ageBandId_fkey" FOREIGN KEY ("ageBandId") REFERENCES "AgeBand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_ageBandId_fkey" FOREIGN KEY ("ageBandId") REFERENCES "AgeBand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequest" ADD CONSTRAINT "VisitRequest_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequest" ADD CONSTRAINT "VisitRequest_hostMemberId_fkey" FOREIGN KEY ("hostMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VisitRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_ageBandId_fkey" FOREIGN KEY ("ageBandId") REFERENCES "AgeBand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_visitRequestId_fkey" FOREIGN KEY ("visitRequestId") REFERENCES "VisitRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
