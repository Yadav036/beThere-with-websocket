import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useWebSocket } from "@/hooks/use-websocket";
import { useLocationReporter } from "@/hooks/use-location-reporter";
import { formatDistance, formatETA, getParticipantStatus } from "@/lib/haversine";
import { useToast } from "@/hooks/use-toast";
import type { EventWithParticipants } from "@shared/schema";

export default function EventPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { user, token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isJoining, setIsJoining] = useState(false);
  const [hasAttemptedJoin, setHasAttemptedJoin] = useState(false);

  // Join event mutation
  const joinEventMutation = useMutation({
    mutationFn: async (eventId: string) => {
      if (!token) throw new Error('No authentication token');

      console.log('🤝 Attempting to join event:', eventId);

      const response = await fetch(`/api/events/${eventId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
        },
      });

      console.log('🤝 Join event response status:', response.status);

      if (!response.ok) {
        if (response.status === 401) {
          setLocation("/login");
          throw new Error('Authentication failed');
        }
        if (response.status === 404) {
          throw new Error('Event not found');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to join event: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Successfully joined event:', result);
      return result;
    },
    onSuccess: () => {
      toast({
        title: "Joined Event!",
        description: "You've successfully joined the event and location sharing is now active.",
      });
      
      // Refetch event data to get updated participant list
      refetch();
    },
    onError: (error) => {
      console.error('❌ Failed to join event:', error);
      toast({
        title: "Failed to join event",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive"
      });
    }
  });

  // Fetch event details with proper authentication
  const { data: event, isLoading, error, refetch } = useQuery<EventWithParticipants>({
    queryKey: ["/api/events", id],
    queryFn: async () => {
      if (!token || !id) {
        throw new Error('No token or event ID available');
      }

      console.log('🔍 Fetching event with ID:', id);

      const response = await fetch(`/api/events/${id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
        },
      });

      console.log('📡 Event fetch response status:', response.status);

      if (!response.ok) {
        if (response.status === 401) {
          console.log('⚠️ Authentication failed, redirecting to login');
          setLocation("/login");
          throw new Error('Authentication failed');
        }
        if (response.status === 404) {
          throw new Error('Event not found');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const eventData = await response.json();
      console.log('✅ Event data received:', eventData);
      return eventData;
    },
    enabled: !!id && !!token,
    retry: (failureCount, error) => {
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('404'))) {
        return false;
      }
      return failureCount < 3;
    },
    refetchInterval: 30000,
  });

  // Check if user is already a participant
  const isUserParticipant = event?.participants?.some(
    p => p.userId === user?.sub || p.userId === user?.id
  ) || false;

  // Auto-join logic
  useEffect(() => {
    if (event && token && user && !isUserParticipant && !hasAttemptedJoin && !isJoining) {
      console.log('🚀 User not in event, attempting auto-join...');
      setIsJoining(true);
      setHasAttemptedJoin(true);
      
      joinEventMutation.mutate(id!, {
        onSettled: () => {
          setIsJoining(false);
        }
      });
    }
  }, [event, token, user, isUserParticipant, hasAttemptedJoin, isJoining, id]);

  // WebSocket connection for real-time updates
  const { connectionStatus, isConnected } = useWebSocket({
    token: token || undefined,
    eventId: id,
    onMessage: (data) => {
      console.log('Event page received WebSocket message:', data);
      if (data.type === 'participant_location_updated' || data.type === 'participant_joined') {
        refetch();
      }
    }
  });

  // Location reporting - only enabled if user is a participant
  const { isReporting } = useLocationReporter({
    eventId: id,
    token: token || undefined,
    enabled: isUserParticipant && isConnected, // Only report if user is participant
    updateInterval: 10000 // 10 seconds
  });

  useEffect(() => {
    if (!token) {
      console.log('⚠️ No token found, redirecting to login');
      setLocation("/login");
    }
  }, [token, setLocation]);

  // Show loading state while joining
  if (isLoading || isJoining) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="retro-border p-6 text-center">
          <div className="text-2xl font-black text-primary mb-2">
            📸 {isJoining ? 'JOINING EVENT...' : 'LOADING EVENT...'}
          </div>
          {isJoining && (
            <p className="text-lg font-bold">Adding you to the event and starting location tracking...</p>
          )}
        </Card>
      </div>
    );
  }

  if (error || !event) {
    console.error('⚠️ Event loading error:', error);
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="retro-border p-6 text-center">
          <div className="text-2xl font-black text-destructive mb-2">⚠️ EVENT NOT FOUND</div>
          <p className="text-lg font-bold mb-4">
            {error instanceof Error ? error.message : 'Failed to load event'}
          </p>
          <div className="space-x-4">
            <Button
              onClick={() => refetch()}
              variant="outline"
              className="bg-white text-black font-bold retro-border hover:bg-secondary"
            >
              🔄 RETRY
            </Button>
            <Button
              onClick={() => setLocation("/home")}
              className="bg-primary text-black font-bold retro-border hover:bg-yellow-400"
            >
              🏠 BACK TO HOME
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const isActive = new Date(event.datetime) > new Date();

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
              <span className={`connection-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
              <span>{isConnected ? 'LIVE' : 'OFFLINE'}</span>
            </div>
          </div>
          <div className="bg-white px-3 py-2 retro-border font-bold">
            👤 {user?.username || user?.email}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Join Success Banner */}
        {isUserParticipant && (
          <Card className="retro-border p-4 bg-green-50">
            <div className="flex items-center justify-center space-x-3">
              <div className="text-2xl">🎉</div>
              <div className="text-lg font-black text-green-800">
                YOU'RE IN! Location sharing is {isReporting ? 'ACTIVE' : 'starting...'}
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
                <Badge className={`font-bold retro-border ${isActive ? 'bg-green-500' : 'bg-muted'} text-black`}>
                  {isActive ? 'ACTIVE' : 'ENDED'}
                </Badge>
                <Badge className="bg-primary text-black font-bold">
                  👥 {event.participants?.length || 0} PARTICIPANTS
                </Badge>
              </div>
              <p className="text-xl font-bold">📍 {event.location}</p>
              <p className="text-lg font-semibold">⏰ {new Date(event.datetime).toLocaleString()}</p>
              {event.description && (
                <p className="text-base text-muted-foreground font-semibold">{event.description}</p>
              )}
              <p className="text-sm text-muted-foreground font-bold">
                Created by: {event.creator?.username || event.creator?.email || 'Unknown'}
              </p>
            </div>
          </div>

          {/* Location Sharing Status */}
          {isActive && event.allowLocationSharing && isUserParticipant && (
            <div className="border-t-4 border-black pt-4">
              <div className="flex items-center justify-between bg-muted p-4 retro-border">
                <div className="flex items-center space-x-3">
                  <div className={`connection-indicator ${isReporting ? 'connected' : 'disconnected'}`}></div>
                  <span className="font-bold">
                    {isReporting ? '📡 Your location is being shared every 10 seconds' : '📡 Starting location sharing...'}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground font-mono">
                  {isConnected ? 'Real-time updates active' : 'Connecting...'}
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
                setIsJoining(true);
                joinEventMutation.mutate(id!, {
                  onSettled: () => setIsJoining(false)
                });
              }}
              disabled={joinEventMutation.isPending}
              className="bg-primary text-black font-bold retro-border hover:bg-yellow-400 px-8 py-3"
            >
              {joinEventMutation.isPending ? '🔄 JOINING...' : '🤝 JOIN EVENT'}
            </Button>
          </Card>
        )}

        {/* Participants List */}
        <Card className="retro-border p-6 space-y-6">
          <h2 className="text-2xl font-black text-black uppercase">Live Participants</h2>
          
          {!event.participants || event.participants.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-xl font-black text-muted-foreground">👥 NO PARTICIPANTS YET</div>
              <p className="text-lg font-bold text-muted-foreground mt-2">Be the first to join!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {event.participants.map((participant) => {
                const status = participant.distanceToEvent 
                  ? getParticipantStatus(participant.distanceToEvent)
                  : 'far';
                const isCurrentUser = participant.userId === user?.sub || participant.userId === user?.id;
                
                return (
                  <div
                    key={participant.id}
                    className={`bg-secondary retro-border p-4 space-y-2 ${isCurrentUser ? 'ring-4 ring-primary' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className={`participant-dot ${participant.isMoving ? 'moving' : status === 'close' ? 'stationary' : 'far'}`}></div>
                        <span className="font-bold">
                          {participant.user?.username || participant.user?.email || 'Unknown User'}
                          {isCurrentUser && ' (You)'}
                        </span>
                      </div>
                      <Badge className={`text-xs font-bold ${
                        participant.isMoving ? 'bg-green-500' : 
                        status === 'close' ? 'bg-primary' : 
                        status === 'arrived' ? 'bg-green-500' : 'bg-orange-500'
                      } text-black`}>
                        {status === 'arrived' ? 'ARRIVED' :
                         participant.isMoving ? 'MOVING' : 
                         status === 'close' ? 'CLOSE' : 'FAR'}
                      </Badge>
                    </div>
                    <div className="space-y-1 text-sm font-mono">
                      <div>📍 {participant.distanceToEvent ? formatDistance(participant.distanceToEvent) : 'Unknown location'}</div>
                      {participant.estimatedArrival && status !== 'arrived' && (
                        <div className="text-green-600 font-bold">
                          ⏱️ ETA: {formatETA((new Date(participant.estimatedArrival).getTime() - Date.now()) / 60000)}
                        </div>
                      )}
                      <div className="text-muted-foreground">
                        {participant.lastLocationAt 
                          ? `Updated ${Math.round((Date.now() - new Date(participant.lastLocationAt).getTime()) / 1000)}s ago`
                          : 'No location data'
                        }
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Real-time Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="retro-border p-4 text-center">
            <div className="text-2xl font-black text-primary">
              {event.participants?.filter(p => p.isMoving).length || 0}
            </div>
            <div className="text-lg font-bold text-black">MOVING</div>
          </Card>
          <Card className="retro-border p-4 text-center">
            <div className="text-2xl font-black text-green-600">
              {event.participants?.filter(p => p.distanceToEvent && p.distanceToEvent < 0.1).length || 0}
            </div>
            <div className="text-lg font-bold text-black">ARRIVED</div>
          </Card>
          <Card className="retro-border p-4 text-center">
            <div className="text-2xl font-black text-orange-600">
              {event.participants?.filter(p => p.distanceToEvent && p.distanceToEvent > 10).length || 0}
            </div>
            <div className="text-lg font-bold text-black">FAR AWAY</div>
          </Card>
        </div>
      </main>
    </div>
  );
}