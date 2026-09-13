-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'client';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'client';

-- CreateTable
CREATE TABLE "LocationAccess" (
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationAccess_pkey" PRIMARY KEY ("userId","locationId")
);

-- CreateIndex
CREATE INDEX "LocationAccess_userId_idx" ON "LocationAccess"("userId");

-- AddForeignKey
ALTER TABLE "LocationAccess" ADD CONSTRAINT "LocationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationAccess" ADD CONSTRAINT "LocationAccess_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
