-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('invited', 'active', 'deactivated');

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('admin', 'owner', 'district_manager', 'technician');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
-- `client` is gone. Everyone who had it reached exactly the locations listed in
-- LocationAccess, and a technician reaches exactly those too — so this preserves what
-- each account can see, to the row. Who is really an owner or a manager is a decision
-- for the Team screen, not for a migration to guess.
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new"
  USING (CASE "role"::text WHEN 'client' THEN 'technician' ELSE "role"::text END)::"UserRole_new";
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'technician';
COMMIT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "districtId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'invited',
ALTER COLUMN "role" SET DEFAULT 'technician';

-- Everyone already here has signed in and confirmed their address, so they are active. The
-- column's default of `invited` is for accounts that arrive from now on, by invitation; left
-- alone it would lock out both existing users the moment this ran.
UPDATE "User" SET "status" = 'active' WHERE "emailVerifiedAt" IS NOT NULL;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDistrict" (
    "userId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDistrict_pkey" PRIMARY KEY ("userId","districtId")
);

-- CreateIndex
CREATE INDEX "District_organizationId_idx" ON "District"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "District_organizationId_name_key" ON "District"("organizationId", "name");

-- CreateIndex
CREATE INDEX "UserDistrict_userId_idx" ON "UserDistrict"("userId");

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE INDEX "Location_districtId_idx" ON "Location"("districtId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDistrict" ADD CONSTRAINT "UserDistrict_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDistrict" ADD CONSTRAINT "UserDistrict_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;
