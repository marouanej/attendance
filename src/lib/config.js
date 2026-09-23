import { z } from "zod";

const configSchema = z.object({
  officeLatitude: z.coerce.number().gte(-90).lte(90),
  officeLongitude: z.coerce.number().gte(-180).lte(180),
  geofenceRadius: z.coerce.number().positive().max(5000),
  maxGpsAccuracy: z.coerce.number().positive().max(1000),
  networkMode: z.enum(["GPS_ONLY", "GPS_PLUS_LOCAL_NETWORK"]),
  minimumScanInterval: z.coerce.number().int().positive(),
});

export function getOfficeConfig() {
  return configSchema.parse({
    officeLatitude: process.env.OFFICE_LATITUDE,
    officeLongitude: process.env.OFFICE_LONGITUDE,
    geofenceRadius: process.env.OFFICE_GEOFENCE_RADIUS_METERS ?? 75,
    maxGpsAccuracy: process.env.MAX_GPS_ACCURACY_METERS ?? 100,
    networkMode: process.env.NETWORK_VERIFICATION_MODE ?? "GPS_ONLY",
    minimumScanInterval: process.env.MINIMUM_SCAN_INTERVAL_SECONDS ?? 120,
  });
}

export const appConfig = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  rpId: process.env.WEBAUTHN_RP_ID,
  rpName: process.env.WEBAUTHN_RP_NAME ?? "Presence Office Attendance",
  origin: process.env.WEBAUTHN_ORIGIN,
};
