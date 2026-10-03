-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "belts" TEXT,
ADD COLUMN     "capacitor" TEXT,
ADD COLUMN     "filter" TEXT,
ADD COLUMN     "passportUpdatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "passportUpdatedById" TEXT;

-- CreateTable
CREATE TABLE "UnitChange" (
    "id" SERIAL NOT NULL,
    "unitId" TEXT NOT NULL,
    "userId" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnitChange_unitId_changedAt_idx" ON "UnitChange"("unitId", "changedAt" DESC);

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_passportUpdatedById_fkey" FOREIGN KEY ("passportUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitChange" ADD CONSTRAINT "UnitChange_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitChange" ADD CONSTRAINT "UnitChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
