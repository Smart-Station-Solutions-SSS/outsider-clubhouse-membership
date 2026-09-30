-- CreateTable
CREATE TABLE "GuestFee" (
    "clubId" TEXT NOT NULL,
    "ageBandId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "GuestFee_pkey" PRIMARY KEY ("clubId","ageBandId")
);

-- AddForeignKey
ALTER TABLE "GuestFee" ADD CONSTRAINT "GuestFee_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestFee" ADD CONSTRAINT "GuestFee_ageBandId_fkey" FOREIGN KEY ("ageBandId") REFERENCES "AgeBand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
