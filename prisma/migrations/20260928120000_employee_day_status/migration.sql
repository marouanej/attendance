-- CreateEnum
CREATE TYPE "EmployeeDayStatusType" AS ENUM ('PERMISSION', 'RECUPERATION', 'ABSENT');

-- CreateTable
CREATE TABLE "EmployeeDayStatus" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" "EmployeeDayStatusType" NOT NULL,
    "durationHours" INTEGER,
    "validUntil" TIMESTAMP(3),
    "setBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDayStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyJobRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDayStatus_employeeId_day_key" ON "EmployeeDayStatus"("employeeId", "day");

-- CreateIndex
CREATE INDEX "EmployeeDayStatus_day_status_idx" ON "EmployeeDayStatus"("day", "status");

-- AddForeignKey
ALTER TABLE "EmployeeDayStatus" ADD CONSTRAINT "EmployeeDayStatus_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
