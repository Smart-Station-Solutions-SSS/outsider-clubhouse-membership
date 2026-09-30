-- AlterTable
ALTER TABLE "AgeBand" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sssId" TEXT;

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "catalogSyncError" TEXT,
ADD COLUMN     "catalogSyncedAt" TIMESTAMP(3),
ADD COLUMN     "outsiderGuestsPerDay" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sssFacilityId" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "sssId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AgeBand_clubId_sssId_key" ON "AgeBand"("clubId", "sssId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_clubId_sssId_key" ON "Plan"("clubId", "sssId");

