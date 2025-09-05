/**
 * Calculate the distance between two points on Earth using the Haversine formula
 * @param lat1 Latitude of first point
 * @param lon1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lon2 Longitude of second point
 * @returns Distance in kilometers
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Check if a participant has moved significantly
 * @param oldLat Previous latitude
 * @param oldLng Previous longitude
 * @param newLat Current latitude
 * @param newLng Current longitude
 * @param thresholdKm Movement threshold in kilometers (default: 0.1 km = 100m)
 * @returns True if participant has moved beyond threshold
 */
export function hasMovedSignificantly(
  oldLat: number, 
  oldLng: number, 
  newLat: number, 
  newLng: number, 
  thresholdKm: number = 0.1
): boolean {
  const distance = calculateDistance(oldLat, oldLng, newLat, newLng);
  return distance >= thresholdKm;
}

/**
 * Categorize participant status based on distance from event
 * @param distanceKm Distance to event in kilometers
 * @returns Status category
 */
export function getParticipantStatus(distanceKm: number): 'arrived' | 'close' | 'moving' | 'far' {
  if (distanceKm < 0.1) return 'arrived';  // Within 100m
  if (distanceKm < 1) return 'close';      // Within 1km
  if (distanceKm < 10) return 'moving';    // Within 10km
  return 'far';                            // More than 10km
}

/**
 * Format distance for display
 * @param distanceKm Distance in kilometers
 * @returns Formatted distance string
 */
export function formatDistance(distanceKm: number): string {
  if (distanceKm < 0.1) {
    return `${Math.round(distanceKm * 1000)}m away`;
  } else if (distanceKm < 1) {
    return `${(distanceKm * 1000).toFixed(0)}m away`;
  } else {
    return `${distanceKm.toFixed(1)} mi away`;
  }
}

/**
 * Format ETA for display
 * @param etaMinutes ETA in minutes from Google Maps API
 * @returns Formatted ETA string
 */
export function formatETA(etaMinutes: number): string {
  if (etaMinutes < 1) return "Arriving now";
  if (etaMinutes < 60) return `${Math.round(etaMinutes)} min`;
  
  const hours = Math.floor(etaMinutes / 60);
  const minutes = Math.round(etaMinutes % 60);
  
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}