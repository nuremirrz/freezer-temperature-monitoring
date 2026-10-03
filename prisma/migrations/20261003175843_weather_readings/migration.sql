-- CreateTable
CREATE TABLE "WeatherReading" (
    "id" SERIAL NOT NULL,
    "locationId" TEXT NOT NULL,
    "tempF" DOUBLE PRECISION NOT NULL,
    "code" INTEGER,
    "measuredAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WeatherReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeatherReading_locationId_measuredAt_key" ON "WeatherReading"("locationId", "measuredAt");

-- AddForeignKey
ALTER TABLE "WeatherReading" ADD CONSTRAINT "WeatherReading_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
