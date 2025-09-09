"use client"

import { useEffect, useRef, useCallback } from "react"
import { useWebSocket } from "./use-websocket"
import { useToast } from "./use-toast"

export interface UseLocationReporterOptions {
  eventId?: string
  token?: string
  enabled?: boolean
  accuracyThreshold?: number
  updateInterval?: number
}

export function useLocationReporter(options: UseLocationReporterOptions) {
  const {
    eventId,
    token,
    enabled = true,
    accuracyThreshold = 50,
    updateInterval = 10000, // 10 seconds
  } = options

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastPositionRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null)
  const { toast } = useToast()

  const { sendMessage, isConnected } = useWebSocket({ 
    token, 
    eventId,
    onMessage: (event, data) => {
      // Handle Socket.IO events if needed
      console.log('📡 Received Socket.IO event:', event, data)
      
      if (event === 'eta_updated') {
        // Handle ETA updates from other participants
        console.log('⏱️ ETA updated for participant:', data)
      }
    }
  })

  const getCurrentLocation = useCallback((): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) reject(new Error("Geolocation not supported"))
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000, // Allow cached position up to 5 seconds old
      })
    })
  }, [])

  const sendLocationUpdate = useCallback(async () => {
    if (!eventId || !enabled || !isConnected) return

    try {
      const pos = await getCurrentLocation()
      const { latitude: lat, longitude: lng, accuracy } = pos.coords
      const timestamp = Date.now()

      console.log("📍 Sending location update:", { lat, lng, accuracy, eventId })

      if (accuracy > accuracyThreshold) {
        console.warn("📍 Location accuracy too low:", accuracy)
        return
      }

      const last = lastPositionRef.current
      if (last) {
        const distance = calculateHaversineDistance(last.lat, last.lng, lat, lng)
        const timeDiff = timestamp - last.timestamp
        // Only skip if very close and recent (reduced threshold for better tracking)
        if (distance < 0.005 && timeDiff < 15000) return
      }

      // 🔄 CHANGED: Use Socket.IO event format instead of WebSocket message format
      const success = sendMessage("location_update", {
        eventId,
        lat,
        lng,
        timestamp: new Date().toISOString(),
        accuracy,
      })

      if (success) {
        lastPositionRef.current = { lat, lng, timestamp }
        console.log("✅ Location update sent successfully")
      } else {
        console.error("❌ Failed to send location update - Socket.IO not ready")
      }
    } catch (err) {
      console.error("❌ Failed to get location:", err)
      
      // Optional: Show toast error for location issues
      if (err instanceof GeolocationPositionError) {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            toast({
              title: "Location Access Denied",
              description: "Please enable location access to share your ETA",
              variant: "destructive"
            })
            break
          case err.POSITION_UNAVAILABLE:
            toast({
              title: "Location Unavailable", 
              description: "Unable to determine your location",
              variant: "destructive"
            })
            break
          case err.TIMEOUT:
            console.warn("📍 Location timeout - will retry on next interval")
            break
        }
      }
    }
  }, [eventId, enabled, isConnected, getCurrentLocation, sendMessage, accuracyThreshold, toast])

  const startReporting = useCallback(() => {
    if (intervalRef.current) {
      console.log("📍 Location reporting already active, clearing previous interval")
      clearInterval(intervalRef.current)
    }

    console.log("📍 Starting location reporting every", updateInterval, "ms")

    // Send immediate location update
    sendLocationUpdate()

    // Set up interval for regular updates
    intervalRef.current = setInterval(sendLocationUpdate, updateInterval)
  }, [sendLocationUpdate, updateInterval])

  const stopReporting = useCallback(() => {
    console.log("📍 Stopping location reporting")
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    lastPositionRef.current = null
  }, [])

  // Start/stop reporting based on connection status and settings
  useEffect(() => {
    if (enabled && eventId && isConnected) {
      console.log("📍 Conditions met for location reporting - starting...")
      const timeout = setTimeout(() => {
        startReporting()
      }, 1000) // Give Socket.IO a moment to fully establish

      return () => {
        clearTimeout(timeout)
        stopReporting()
      }
    } else {
      console.log("📍 Conditions not met for location reporting:", {
        enabled,
        hasEventId: !!eventId,
        isConnected,
      })
      stopReporting()
    }
  }, [enabled, eventId, isConnected, startReporting, stopReporting])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopReporting()
    }
  }, [stopReporting])

  return {
    startLocationReporting: startReporting,
    stopLocationReporting: stopReporting,
    isReporting: intervalRef.current !== null,
  }
}

// Haversine distance calculation
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371 // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}