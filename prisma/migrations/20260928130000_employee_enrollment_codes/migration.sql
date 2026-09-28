ALTER TABLE "Employee"
ADD COLUMN "enrollmentCodeHash" TEXT,
ADD COLUMN "enrollmentCodeExpiresAt" TIMESTAMP(3);

ALTER TABLE "WebAuthnChallenge"
ADD COLUMN "enrollmentCodeHash" TEXT;