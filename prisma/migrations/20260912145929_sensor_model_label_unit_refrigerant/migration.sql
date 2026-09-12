-- AlterTable
ALTER TABLE "Sensor" ADD COLUMN     "label" TEXT,
ADD COLUMN     "model" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "refrigerant" TEXT;
