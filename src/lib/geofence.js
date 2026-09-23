const EARTH_RADIUS_METERS = 6371000;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

export function haversineDistance(from, to) {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const latitudeOne = toRadians(from.latitude);
  const latitudeTwo = toRadians(to.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeOne) * Math.cos(latitudeTwo) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validateCoordinates(input, office) {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const accuracy = Number(input.accuracy);
  if (![latitude, longitude, accuracy].every(Number.isFinite)) return { ok: false, reason: "INVALID_COORDINATES" };
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracy < 0) return { ok: false, reason: "INVALID_COORDINATES" };
  const distance = haversineDistance({ latitude, longitude }, office);
  const ok = distance <= office.radius && accuracy <= office.maxAccuracy;
  return { ok, distance, latitude, longitude, accuracy, reason: ok ? null : distance > office.radius ? "OUTSIDE_GEOFENCE" : "GPS_ACCURACY_TOO_LOW" };
}
