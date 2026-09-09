-- AlterTable
ALTER TABLE "Sensor" ADD COLUMN     "ambientHum" DOUBLE PRECISION,
ADD COLUMN     "ambientTempF" DOUBLE PRECISION,
ADD COLUMN     "batStatus" TEXT,
ADD COLUMN     "expectedIntervalSec" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "nodeType" TEXT;

-- AlterTable
ALTER TABLE "UnknownUplink" ADD COLUMN     "reason" TEXT;
