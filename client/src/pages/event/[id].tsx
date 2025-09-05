"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useLocation, useParams } from "wouter"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth"
import { useWebSocket } from "@/hooks/use-websocket"
import { useLocationReporter } from "@/hooks/use-location-reporter"
import { useGoogleDirections } from "@/hooks/use-google-directions"
import { useToast } from "@/hooks/use-toast"
import type { EventWithParticipants } from "@shared/schema"

interface ParticipantWithETA {
  id: string
  userId: string
  user?: {
    username?: string
    email?: string
  }
  lastLat?: number
  lastLng?: number
  lastLocationAt?: string
  isMoving: boolean
  // Google Maps data
  googleETA?: number // minutes
  googleDistance?: number // meters
  googleETAText?: string
  googleDistanceText?: string
  // Status derived from Google data
  status: "arrived" | "close" | "moving" | "far"
  // Leave by time calculation
  leaveByTime?: Date
  leaveByText?: string
  shouldLeaveNow?: boolean
}

export default function EventPage() {
  const { id } = useParams()
  const [, setLocation] = useLocation()
  const { user, token } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [isJoining, setIsJoining] = useState(false)
  const [hasAttemptedJoin, setHasAttemptedJoin] = useState(false)
  const [participantsWithETA, setParticipantsWithETA] = useState<ParticipantWithETA[]>([])
  const [isCalculatingETAs, setIsCalculatingETAs] = useState(false)

  // ✅ Added: interval constant and last calculation timestamp state
  const ETA_CALCULATION_INTERVAL = 60_000 // 60s
  const lastETACalculationRef = useRef<number>(0)
  // Optional: lightweight ticker to keep countdown fresh
  const [nowTick, setNowTick] = useState<number>(Date.now())

  const { getDirections, isLoading: directionsLoading, error: directionsError } = useGoogleDirections()

  console.log("🎯 EventPage render:", {
    eventId: id,
    userId: user?.sub || user?.id,
    hasToken: !!token,
    timestamp: new Date().toISOString(),
  })

  // Helper function to calculate leave by time
  const calculateLeaveByTime = useCallback((eventDateTime: string, etaMinutes: number) => {
    const eventTime = new Date(eventDateTime)
    // Target arrival: 5 minutes before event
    const targetArrivalTime = new Date(eventTime.getTime() - 5 * 60 * 1000)
    // Leave by time: target arrival - ETA
    const leaveByTime = new Date(targetArrivalTime.getTime() - etaMinutes * 60 * 1000)
    
    const now = new Date()
    const shouldLeaveNow = now >= leaveByTime
    
    const leaveByText = leaveByTime.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    })
    
    return {
      leaveByTime,
      leaveByText,
      shouldLeaveNow
    }
  }, [])

  // Join event mutation
  const joinEventMutation = useMutation({
    mutationFn: async (eventId: string) => {
      if (!token) throw new Error("No authentication token")

      console.log("🤝 Attempting to join event:", eventId)

      const response = await fetch(`/api/events/${eventId}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
      })

      console.log("🤝 Join event response status:", response.status)

      if (!response.ok) {
        if (response.status === 401) {
          setLocation("/login")
          throw new Error("Authentication failed")
        }
        if (response.status === 404) {
          throw new Error("Event not found")
        }
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to join event: ${response.status}`)
      }

      const result = await response.json()
      console.log("✅ Successfully joined event:", result)
      return result
    },
    onSuccess: () => {
      toast({
        title: "Joined Event!",
        description: "You've successfully joined the event and location sharing is now active.",
      })
      // Refetch event data to get updated participant list
      refetch()
    },
    onError: (error) => {
      console.error("❌ Failed to join event:", error)
      toast({
        title: "Failed to join event",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      })
    },
  })

  // Fetch event details with proper authentication
  const {
    data: event,
    isLoading,
    error,
    refetch,
  } = useQuery<EventWithParticipants>({
    queryKey: ["/api/events", id],
    queryFn: async () => {
      if (!token || !id) {
        throw new Error("No token or event ID available")
      }

      console.log("📍 Fetching event with ID:", id)

      const response = await fetch(`/api/events/${id}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
      })

      console.log("📡 Event fetch response status:", response.status)

      if (!response.ok) {
        if (response.status === 401) {
          console.log("⚠️ Authentication failed, redirecting to login")
          setLocation("/login")
          throw new Error("Authentication failed")
        }
        if (response.status === 404) {
          throw new Error("Event not found")
        }
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
      }

      const eventData = await response.json()
      console.log("✅ Event data received:", eventData)
      return eventData
    },
    enabled: !!id && !!token,
    retry: (failureCount, error) => {
      if (error instanceof Error && (error.message.includes("401") || error.message.includes("404"))) {
        return false
      }
      return failureCount < 3
    },
    refetchInterval: 30000,
  })

  // Check if user is already a participant
  const isUserParticipant = event?.participants?.some((p) => p.userId === user?.sub || p.userId === user?.id) || false

  // Calculate ETAs for all participants using Google Maps with throttling
  const calculateParticipantETAs = useCallback(
    async (forceUpdate = false) => {
      const now = Date.now()
      const timeSinceLastCalculation = now - lastETACalculationRef.current

      // Check if we should skip this calculation due to throttling
      if (!forceUpdate && timeSinceLastCalculation < ETA_CALCULATION_INTERVAL) {
        console.log("🗺️ Skipping ETA calculation due to throttling:", {
          timeSinceLastCalculation,
          intervalRequired: ETA_CALCULATION_INTERVAL,
          timeRemaining: ETA_CALCULATION_INTERVAL - timeSinceLastCalculation,
        })
        return
      }

      if (!event?.participants || !event.location || isCalculatingETAs) {
        console.log("🗺️ Skipping ETA calculation:", {
          hasParticipants: !!event?.participants?.length,
          hasLocation: !!event?.location,
          isCalculating: isCalculatingETAs,
        })
        return
      }

      console.log("🗺️ Starting ETA calculation for", event.participants.length, "participants")
      setIsCalculatingETAs(true)

      const updatedParticipants: ParticipantWithETA[] = []

      for (const participant of event.participants) {
        console.log("🧭 Processing participant:", participant.userId, {
          hasLocation: !!(participant.lastLat && participant.lastLng),
          isMoving: participant.isMoving,
        })

        if (!participant.lastLat || !participant.lastLng) {
          // No location data available
          updatedParticipants.push({
            ...participant,
            status: "far",
          })
          continue
        }

        try {
          const origin = `${participant.lastLat},${participant.lastLng}`
          const destination = event.location

          console.log("🚗 Fetching directions:", { origin, destination })

          const directions = await getDirections(origin, destination, "driving")

          if (directions) {
            console.log("✅ Directions received:", {
              participantId: participant.userId,
              duration: directions.duration,
              distance: directions.distance,
              durationText: directions.durationText,
              distanceText: directions.distanceText,
            })

            // Determine status based on distance and ETA
            let status: "arrived" | "close" | "moving" | "far" = "far"
            const distanceKm = directions.distance / 1000

            if (distanceKm < 0.1)
              status = "arrived" // Within 100m
            else if (distanceKm < 1)
              status = "close" // Within 1km
            else if (distanceKm < 10)
              status = "moving" // Within 10km
            else status = "far" // More than 10km

            // Calculate leave by time
            const etaMinutes = Math.round(directions.duration / 60)
            const leaveByInfo = calculateLeaveByTime(event.datetime, etaMinutes)

            updatedParticipants.push({
              ...participant,
              googleETA: etaMinutes,
              googleDistance: directions.distance,
              googleETAText: directions.durationText,
              googleDistanceText: directions.distanceText,
              status,
              ...leaveByInfo,
            })
          } else {
            console.log("❌ No directions received for participant:", participant.userId)
            updatedParticipants.push({
              ...participant,
              status: "far",
            })
          }
        } catch (error) {
          console.error("❌ Error calculating ETA for participant:", participant.userId, error)
          updatedParticipants.push({
            ...participant,
            status: "far",
          })
        }

        // Add small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      console.log("🗺️ ETA calculation complete:", {
        total: updatedParticipants.length,
        withETA: updatedParticipants.filter((p) => p.googleETA).length,
      })

      setParticipantsWithETA(updatedParticipants)
      // ✅ Added: store the last calculation timestamp
      lastETACalculationRef.current = Date.now()
      setIsCalculatingETAs(false)
    },
    [event?.participants, event?.location, event?.datetime, getDirections, isCalculatingETAs],
  )

  // Auto-join logic
  useEffect(() => {
    if (event && token && user && !isUserParticipant && !hasAttemptedJoin && !isJoining) {
      console.log("🚀 User not in event, attempting auto-join...")
      setIsJoining(true)
      setHasAttemptedJoin(true)

      joinEventMutation.mutate(id!, {
        onSettled: () => {
          setIsJoining(false)
        },
      })
    }
  }, [event, token, user, isUserParticipant, hasAttemptedJoin, isJoining, id])

  // Calculate ETAs when participants data changes, but with throttling
  useEffect(() => {
    if (event?.participants && event.location) {
      console.log("🔄 Participants or location changed, checking if ETA calculation needed...")
      // Only calculate if we haven't calculated recently
      calculateParticipantETAs(false) // false = respect throttling
    }
  }, [event?.participants, event?.location])

  // Auto-refresh ETAs every 60 seconds
  useEffect(() => {
    if (!event?.participants || !event.location) return

    const interval = setInterval(() => {
      console.log("⏰ Auto-refreshing ETAs after 60 seconds...")
      calculateParticipantETAs(true) // true = force update, ignore throttling
    }, ETA_CALCULATION_INTERVAL)

    return () => clearInterval(interval)
  }, [event?.participants, event?.location, calculateParticipantETAs])

  // Keep the countdown fresh every second while we have a last calculation
  useEffect(() => {
    if (!lastETACalculationRef.current) return
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [lastETACalculationRef.current])

  // WebSocket connection for real-time updates
  const { connectionStatus, isConnected } = useWebSocket({
    token: token || undefined,
    eventId: id,
    onMessage: (data) => {
      console.log("📨 Event page received WebSocket message:", data)
      if (
        data.type === "participant_location_updated" ||
        data.type === "participant_joined" ||
        data.type === "eta_updated"
      ) {
        console.log("🔄 Refreshing data due to WebSocket message")
        refetch()
      }
    },
  })

  // Location reporting - only enabled if user is a participant
  const { isReporting } = useLocationReporter({
    eventId: id,
    token: token || undefined,
    enabled: isUserParticipant && isConnected, // Only report if user is participant
    updateInterval: 10000, // 10 seconds
  })

  useEffect(() => {
    if (!token) {
      console.log("⚠️ No token found, redirecting to login")
      setLocation("/login")
    }
  }, [token, setLocation])

  // Loading and error states
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-2xl font-black">LOADING EVENT...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-2xl font-black text-red-600">
          ERROR LOADING EVENT: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-2xl font-black">EVENT NOT FOUND</div>
      </div>
    )
  }

  const secondsLeft = lastETACalculationRef.current
    ? Math.max(0, Math.round((ETA_CALCULATION_INTERVAL - (Date.now() - lastETACalculationRef.current)) / 1000))
    : 0

  const isActive = new Date(event.datetime) > new Date()

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="snap-header p-6 text-black">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button
              onClick={() => setLocation("/home")}
              variant="outline"
              className="font-bold retro-border border-4 border-black hover:bg-secondary"
            >
              ← BACK
            </Button>
            <div className="text-3xl font-black">📸 {event.name}</div>
            {/* Connection Status */}
            <div className="flex items-center bg-black text-white px-3 py-1 text-sm font-bold">
              <span className={`connection-indicator ${isConnected ? "connected" : "disconnected"}`}></span>
              <span>{isConnected ? "LIVE" : "OFFLINE"}</span>
            </div>
          </div>
          <div className="bg-white px-3 py-2 retro-border font-bold">👤 {user?.username || user?.email}</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Join Success Banner */}
        {isUserParticipant && (
          <Card className="retro-border p-4 bg-green-50">
            <div className="flex items-center justify-center space-x-3">
              <div className="text-2xl">🎉</div>
              <div className="text-lg font-black text-green-800">
                YOU'RE IN! Location sharing is {isReporting ? "ACTIVE" : "starting..."}
              </div>
            </div>
          </Card>
        )}

        {/* Event Details */}
        <Card className="retro-border p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <h1 className="text-3xl font-black text-black">{event.name || event.title}</h1>
                <Badge className={`font-bold retro-border ${isActive ? "bg-green-500" : "bg-muted"} text-black`}>
                  {isActive ? "ACTIVE" : "ENDED"}
                </Badge>
                <Badge className="bg-primary text-black font-bold">
                  👥 {participantsWithETA.length || event.participants?.length || 0} PARTICIPANTS
                </Badge>
              </div>
              <p className="text-xl font-bold">📍 {event.location}</p>
              <p className="text-lg font-semibold">⏰ {new Date(event.datetime).toLocaleString()}</p>
              {event.description && (
                <p className="text-base text-muted-foreground font-semibold">{event.description}</p>
              )}
              <p className="text-sm text-muted-foreground font-bold">
                Created by: {event.creator?.username || event.creator?.email || "Unknown"}
              </p>
            </div>
          </div>

          {/* Location Sharing Status */}
          {isActive && event.allowLocationSharing && isUserParticipant && (
            <div className="border-t-4 border-black pt-4">
              <div className="flex items-center justify-between bg-muted p-4 retro-border">
                <div className="flex items-center space-x-3">
                  <div className={`connection-indicator ${isReporting ? "connected" : "disconnected"}`}></div>
                  <span className="font-bold">
                    {isReporting
                      ? "📡 Your location is being shared every 10 seconds"
                      : "📡 Starting location sharing..."}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground font-mono">
                  {isConnected ? "Real-time updates active" : "Connecting..."}
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Manual Join Button (fallback if auto-join failed) */}
        {!isUserParticipant && !isJoining && (
          <Card className="retro-border p-6 text-center">
            <h3 className="text-xl font-black text-black mb-4">Join this event to start location sharing!</h3>
            <Button
              onClick={() => {
                setIsJoining(true)
                joinEventMutation.mutate(id!, {
                  onSettled: () => setIsJoining(false),
                })
              }}
              disabled={joinEventMutation.isPending}
              className="bg-primary text-black font-bold retro-border hover:bg-yellow-400 px-8 py-3"
            >
              {joinEventMutation.isPending ? "🔄 JOINING..." : "🤝 JOIN EVENT"}
            </Button>
          </Card>
        )}

        {/* ETA Calculation Status */}
        {isCalculatingETAs ? (
          <Card className="retro-border p-4 bg-blue-50">
            <div className="flex items-center justify-center space-x-3">
              <div className="text-xl">🗺️</div>
              <div className="text-lg font-black text-blue-800">CALCULATING REAL-TIME ETAS...</div>
            </div>
          </Card>
        ) : participantsWithETA.length > 0 && lastETACalculationRef.current > 0 ? (
          <Card className="retro-border p-4 bg-green-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="text-xl">✅</div>
                <div className="text-lg font-black text-green-800">
                  ETAS UPDATED - Next refresh in {secondsLeft} seconds
                </div>
              </div>
              <div className="text-sm text-green-600 font-mono">
                Last updated:{" "}
                {lastETACalculationRef.current ? new Date(lastETACalculationRef.current).toLocaleTimeString() : "Never"}
              </div>
            </div>
          </Card>
        ) : null}

        {/* Participants List */}
        <Card className="retro-border p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black text-black uppercase">Live Participants</h2>
            {participantsWithETA.length > 0 && (
              <Button
                onClick={() => calculateParticipantETAs(true)} // Force update when manually refreshed
                disabled={isCalculatingETAs || directionsLoading}
                variant="outline"
                className="font-bold retro-border"
              >
                {isCalculatingETAs ? "🔄 UPDATING..." : "🔄 REFRESH ETAS"}
              </Button>
            )}
          </div>

          {!participantsWithETA.length && !event.participants?.length ? (
            <div className="text-center py-8">
              <div className="text-xl font-black text-muted-foreground">👥 NO PARTICIPANTS YET</div>
              <p className="text-lg font-bold text-muted-foreground mt-2">Be the first to join!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(participantsWithETA.length > 0 ? participantsWithETA : event?.participants || []).map((participant) => {
                const isCurrentUser = participant.userId === (user?.sub || user?.id)
                const status = participant.status || "far"

                return (
                  <div
                    key={participant.id}
                    className={`bg-secondary retro-border p-4 space-y-3 ${isCurrentUser ? "ring-4 ring-primary" : ""} ${
                      participant.shouldLeaveNow ? "ring-2 ring-red-500 bg-red-50" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div
                          className={`participant-dot ${
                            participant.isMoving
                              ? "moving"
                              : status === "close"
                                ? "stationary"
                                : status === "arrived"
                                  ? "arrived"
                                  : "far"
                          }`}
                        ></div>
                        <span className="font-bold">
                          {participant.user?.username || participant.user?.email || "Unknown User"}
                          {isCurrentUser && " (You)"}
                        </span>
                      </div>
                      <Badge
                        className={`text-xs font-bold ${
                          status === "arrived"
                            ? "bg-green-500"
                            : participant.isMoving
                              ? "bg-blue-500"
                              : status === "close"
                                ? "bg-primary"
                                : "bg-orange-500"
                        } text-black`}
                      >
                        {status === "arrived"
                          ? "ARRIVED"
                          : participant.isMoving
                            ? "MOVING"
                            : status === "close"
                              ? "CLOSE"
                              : "FAR"}
                      </Badge>
                    </div>

                    <div className="space-y-1 text-sm font-mono">
                      {/* Google Maps Distance */}
                      <div className="text-blue-600 font-bold">
                        📍 {participant.googleDistanceText || "Calculating distance..."}
                      </div>

                      {/* Google Maps ETA */}
                      {participant.googleETAText && status !== "arrived" && (
                        <div className="text-green-600 font-bold">⏱️ ETA: {participant.googleETAText}</div>
                      )}

                      {/* Leave By Time - New Feature */}
                      {participant.leaveByText && status !== "arrived" && (
                        <div className={`font-bold ${participant.shouldLeaveNow ? "text-red-600 animate-pulse" : "text-purple-600"}`}>
                          🚪 Leave by: {participant.leaveByText}
                          {participant.shouldLeaveNow && (
                            <div className="text-red-700 text-xs mt-1 uppercase tracking-wide">
                              ⚠️ SHOULD LEAVE NOW!
                            </div>
                          )}
                        </div>
                      )}

                      {/* Status indicator */}
                      {status === "arrived" && <div className="text-green-700 font-bold">🎯 AT DESTINATION</div>}

                      {/* Movement indicator */}
                      {participant.isMoving && <div className="text-blue-600 font-bold">🚶 Currently moving</div>}

                      {/* Last updated */}
                      <div className="text-muted-foreground">
                        {participant.lastLocationAt
                          ? `Updated ${Math.round(
                              (Date.now() - new Date(participant.lastLocationAt).getTime()) / 1000,
                            )}s ago`
                          : "No location data"}
                      </div>

                      {/* Error state */}
                      {!participant.googleDistanceText && participant.lastLat && participant.lastLng && (
                        <div className="text-orange-600 text-xs">⚠️ ETA calculation in progress...</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Real-time Stats */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card className="retro-border p-4 text-center">
            <div className="text-2xl font-black text-blue-600">
              {participantsWithETA.filter((p) => p.isMoving).length || 0}
            </div>
            <div className="text-lg font-bold text-black">MOVING</div>
          </Card>
          <Card className="retro-border p-4 text-center">
            <div className="text-2xl font-black text-green-600">
              {participantsWithETA.filter((p) => p.status === "arrived").length || 0}
            </div>
            <div className="text-lg font-bold text-black">ARRIVED</div>
          </Card>
          <Card className="retro-border p-4 text-center">
            <div className="text-2xl font-black text-yellow-600">
              {participantsWithETA.filter((p) => p.status === "close").length || 0}
            </div>
            <div className="text-lg font-bold text-black">CLOSE</div>
          </Card>
          <Card className="retro-border p-4 text-center">
            <div className="text-2xl font-black text-orange-600">
              {participantsWithETA.filter((p) => p.status === "far").length || 0}
            </div>
            <div className="text-lg font-bold text-black">FAR AWAY</div>
          </Card>
          <Card className="retro-border p-4 text-center">
            <div className="text-2xl font-black text-red-600">
              {participantsWithETA.filter((p) => p.shouldLeaveNow).length || 0}
            </div>
            <div className="text-lg font-bold text-black">SHOULD LEAVE</div>
          </Card>
        </div>

        {/* Directions Error Display */}
        {directionsError && (
          <Card className="retro-border p-4 bg-red-50">
            <div className="flex items-center space-x-3">
              <div className="text-xl">⚠️</div>
              <div className="text-sm font-bold text-red-800">Error calculating directions: {directionsError}</div>
            </div>
          </Card>
        )}
      </main>
    </div>
  )
}