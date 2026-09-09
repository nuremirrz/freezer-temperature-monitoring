-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('freezer', 'walk_in_freezer', 'walk_in_cooler', 'ac');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('temp_out_of_range', 'offline');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gateway" (
    "id" TEXT NOT NULL,
    "ttnGatewayId" TEXT NOT NULL,
    "eui" TEXT,
    "locationId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6),

    CONSTRAINT "Gateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "UnitType" NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "serial" TEXT,
    "year" INTEGER,
    "rangeMinF" DOUBLE PRECISION NOT NULL,
    "rangeMaxF" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sensor" (
    "id" TEXT NOT NULL,
    "devEui" TEXT NOT NULL,
    "ttnDeviceId" TEXT,
    "locationId" TEXT NOT NULL,
    "batteryV" DOUBLE PRECISION,
    "batteryPct" INTEGER,
    "lastRssi" INTEGER,
    "lastSnr" DOUBLE PRECISION,
    "lastSeenAt" TIMESTAMPTZ(6),

    CONSTRAINT "Sensor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensorChannel" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "channel" INTEGER NOT NULL,
    "unitId" TEXT,

    CONSTRAINT "SensorChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reading" (
    "id" SERIAL NOT NULL,
    "unitId" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "channel" INTEGER NOT NULL,
    "tempF" DOUBLE PRECISION NOT NULL,
    "measuredAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),
    "peakTempF" DOUBLE PRECISION,
    "lastNotifiedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnknownUplink" (
    "id" SERIAL NOT NULL,
    "devEui" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnknownUplink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Gateway_ttnGatewayId_key" ON "Gateway"("ttnGatewayId");

-- CreateIndex
CREATE UNIQUE INDEX "Gateway_eui_key" ON "Gateway"("eui");

-- CreateIndex
CREATE INDEX "Gateway_locationId_idx" ON "Gateway"("locationId");

-- CreateIndex
CREATE INDEX "Unit_locationId_idx" ON "Unit"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_locationId_name_key" ON "Unit"("locationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Sensor_devEui_key" ON "Sensor"("devEui");

-- CreateIndex
CREATE INDEX "Sensor_locationId_idx" ON "Sensor"("locationId");

-- CreateIndex
CREATE INDEX "SensorChannel_unitId_idx" ON "SensorChannel"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "SensorChannel_sensorId_channel_key" ON "SensorChannel"("sensorId", "channel");

-- CreateIndex
CREATE INDEX "Reading_unitId_measuredAt_idx" ON "Reading"("unitId", "measuredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Reading_sensorId_channel_measuredAt_key" ON "Reading"("sensorId", "channel", "measuredAt");

-- CreateIndex
CREATE INDEX "Alert_unitId_resolvedAt_idx" ON "Alert"("unitId", "resolvedAt");

-- CreateIndex
CREATE INDEX "Alert_resolvedAt_idx" ON "Alert"("resolvedAt");

-- CreateIndex
CREATE INDEX "UnknownUplink_devEui_idx" ON "UnknownUplink"("devEui");

-- AddForeignKey
ALTER TABLE "Gateway" ADD CONSTRAINT "Gateway_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensorChannel" ADD CONSTRAINT "SensorChannel_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensorChannel" ADD CONSTRAINT "SensorChannel_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
