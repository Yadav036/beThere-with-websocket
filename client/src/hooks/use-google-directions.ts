"use client"

import { useState, useCallback } from "react"
import { useAuth } from "@/lib/auth"

interface DirectionsResult {
  duration: number // seconds
  distance: number // meters
  durationText: string
  distanceText: string
}

interface UseGoogleDirectionsReturn {
  getDirections: (origin: string, destination: string, mode?: string) => Promise<DirectionsResult | null>
  isLoading: boolean
  error: string | null
}

export function useGoogleDirections(): UseGoogleDirectionsReturn {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { token } = useAuth()

  const getDirections = useCallback(
    async (origin: string, destination: string, mode = "driving"): Promise<DirectionsResult | null> => {
      console.log(" 🗺️ useGoogleDirections.getDirections called:", {
        origin,
        destination,
        mode,
        hasToken: !!token,
        timestamp: new Date().toISOString(),
      })

      if (!token) {
        console.log(" ❌ useGoogleDirections: No authentication token available")
        setError("Authentication required")
        return null
      }

      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          origin,
          destination,
          mode,
        })

        const url = `/api/directions?${params}`
        console.log("[v0] 📡 useGoogleDirections: Making API request to:", url)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          console.log("⏰ useGoogleDirections: Request timeout after 30 seconds")
          controller.abort()
        }, 30000) // 30 second timeout

        const response = await fetch(url, {
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        console.log("[v0] 📡 useGoogleDirections: Response received:", {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries()),
        })

        if (!response.ok) {
          const errorData = await response.json().catch((err) => {
            console.log(" ❌ useGoogleDirections: Failed to parse error response as JSON:", err)
            return { error: `HTTP ${response.status}: ${response.statusText}` }
          })

          console.log(" ❌ useGoogleDirections: API error response:", errorData)
          throw new Error(errorData.error || "Failed to get directions")
        }

        const data = await response.json()
        console.log(" ✅ useGoogleDirections: Success response:", data)
        return data
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error"
        console.log(" ❌ useGoogleDirections: Exception caught:", {
          error: errorMessage,
          stack: err instanceof Error ? err.stack : "No stack trace",
          type: typeof err,
          origin,
          destination,
        })
        setError(errorMessage)
        return null
      } finally {
        console.log("[v0] 🏁 useGoogleDirections: Request completed, setting loading to false")
        setIsLoading(false)
      }
    },
    [token],
  )

  return { getDirections, isLoading, error }
}
