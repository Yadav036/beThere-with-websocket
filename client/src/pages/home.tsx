import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import type { Event, EventWithParticipants } from "@shared/schema";
import { LocationAutocomplete } from "@/components/location-autocomplete.tsx";

interface CreateEventData {
  name: string;
  location: string;
  datetime: string;
  description?: string;
  allowLocationSharing: boolean;
  latitude?: number;
  longitude?: number;
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { user, token, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [formData, setFormData] = useState<CreateEventData>({
    name: "",
    location: "",
    datetime: "",
    description: "",
    allowLocationSharing: true,
    latitude: undefined,
    longitude: undefined
  });

  // Fetch user's events
  const { data: events, isLoading: eventsLoading, refetch } = useQuery<EventWithParticipants[]>({
    queryKey: ["/api/events"],
    queryFn: async () => {
      if (!token) throw new Error('No authentication token');

      const response = await fetch('/api/events', {
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          setLocation("/login");
          throw new Error('Authentication failed');
        }
        throw new Error('Failed to fetch events');
      }

      return response.json();
    },
    enabled: !!token
  });

  // Create event mutation
  const createEventMutation = useMutation({
    mutationFn: async (eventData: CreateEventData) => {
      if (!token) throw new Error('No authentication token');

      const response = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create event');
      }

      return response.json();
    },
    onSuccess: (newEvent) => {
      toast({
        title: "Event Created!",
        description: `${newEvent.name} has been created successfully.`
      });
      
      // Reset form
      setFormData({
        name: "",
        location: "",
        datetime: "",
        description: "",
        allowLocationSharing: true,
        latitude: undefined,
        longitude: undefined
      });
      
      // Refresh events list
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      
      // Navigate to the new event
      setLocation(`/event/${newEvent.id}`);
    },
    onError: (error) => {
      toast({
        title: "Failed to create event",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive"
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim() || !formData.location.trim() || !formData.datetime) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    // Ensure datetime is in the future
    const eventDate = new Date(formData.datetime);
    const now = new Date();
    if (eventDate <= now) {
      toast({
        title: "Invalid Date",
        description: "Event date must be in the future",
        variant: "destructive"
      });
      return;
    }

    createEventMutation.mutate(formData);
  };

  const handleInputChange = (field: keyof CreateEventData, value: string | boolean | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30); // Minimum 30 minutes from now
    return now.toISOString().slice(0, 16);
  };

  if (!token) {
    setLocation("/login");
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="snap-header p-6 text-black">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="text-3xl font-black">📸 SNAPMEET</div>
          <div className="flex items-center space-x-4">
            <div className="bg-white px-3 py-2 retro-border font-bold">
              👤 {user?.username || user?.email}
            </div>
            <Button
              onClick={logout}
              variant="outline"
              className="font-bold retro-border border-4 border-black hover:bg-secondary"
            >
              LOGOUT
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Create Event Form */}
        <Card className="retro-border p-6">
          <CardHeader>
            <CardTitle className="text-2xl font-black text-black">CREATE NEW EVENT</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-lg font-bold mb-2">Event Name *</label>
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Beach Party 2025"
                    className="retro-border font-semibold"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-lg font-bold mb-2">Location *</label>
                  <LocationAutocomplete
                    value={formData.location}
                    onChange={(val) => handleInputChange('location', val)}
                    onLocationSelect={(loc) => {
                      // Update location address and coordinates
                      handleInputChange('location', loc.address);
                      handleInputChange('latitude', loc.lat);
                      handleInputChange('longitude', loc.lng);
                    }}
                    placeholder="Search for a location..."
                    disabled={false}
                  />
                </div>
              </div>

              <div>
                <label className="block text-lg font-bold mb-2">Date & Time *</label>
                <Input
                  type="datetime-local"
                  value={formData.datetime}
                  onChange={(e) => handleInputChange('datetime', e.target.value)}
                  min={getMinDateTime()}
                  className="retro-border font-semibold"
                  required
                />
              </div>

              <div>
                <label className="block text-lg font-bold mb-2">Description</label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Fun beach party with games and music!"
                  className="retro-border font-semibold"
                  rows={3}
                />
              </div>

              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="allowLocationSharing"
                  checked={formData.allowLocationSharing}
                  onChange={(e) => handleInputChange('allowLocationSharing', e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="allowLocationSharing" className="text-lg font-bold">
                  Enable Live Location Tracking
                </label>
              </div>

              <Button
                type="submit"
                disabled={createEventMutation.isPending}
                className="bg-primary text-black font-bold retro-border hover:bg-yellow-400 w-full md:w-auto px-8 py-3"
              >
                {createEventMutation.isPending ? '🔄 CREATING...' : '🚀 CREATE EVENT'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Your Events */}
        <Card className="retro-border p-6">
  <CardHeader>
    <CardTitle className="text-2xl font-black text-black">YOUR EVENTS</CardTitle>
  </CardHeader>
  <CardContent>
    {eventsLoading ? (
      <div className="text-center py-8">
        <div className="text-xl font-black text-primary">📸 LOADING EVENTS...</div>
      </div>
    ) : !events || events.length === 0 ? (
      <div className="text-center py-8">
        <div className="text-xl font-black text-muted-foreground">📅 NO EVENTS YET</div>
        <p className="text-lg font-bold text-muted-foreground mt-2">
          Create your first event to get started!
        </p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {events.map((event) => {
          const isActive = new Date(event.datetime) > new Date();
          const isPast = new Date(event.datetime) < new Date();
          const isCreator = event.creatorId === user.id; // assumes you have user from auth context

          return (
            <Card
              key={event.id}
              className="retro-border cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => setLocation(`/event/${event.id}`)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-black text-black truncate">
                    {event.name}
                  </h3>
                  <Badge
                    className={`ml-2 font-bold retro-border ${
                      isActive ? "bg-green-500" : isPast ? "bg-muted" : "bg-orange-500"
                    } text-black`}
                  >
                    {isActive ? "LIVE" : isPast ? "ENDED" : "UPCOMING"}
                  </Badge>
                </div>

                <div className="space-y-2 text-sm font-semibold">
                  <div className="flex items-center">
                    <span>📍 {event.location}</span>
                  </div>
                  <div className="flex items-center">
                    <span>
                      ⏰{" "}
                      {new Date(event.datetime).toLocaleDateString()} at{" "}
                      {new Date(event.datetime).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>👥 {event.participants?.length || 0} participants</span>
                    {event.allowLocationSharing && (
                      <Badge className="bg-primary text-black text-xs font-bold">
                        📡 TRACKING
                      </Badge>
                    )}
                  </div>
                </div>

                {event.description && (
                  <p className="text-sm text-muted-foreground font-medium truncate">
                    {event.description}
                  </p>
                )}

                <div className="flex space-x-2">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocation(`/event/${event.id}`);
                    }}
                    className="flex-1 bg-secondary text-black font-bold retro-border hover:bg-primary"
                    size="sm"
                  >
                    {isActive ? "🔴 JOIN LIVE" : "📋 VIEW DETAILS"}
                  </Button>

                  {isCreator && (
                    <Button
  onClick={async (e) => {
    e.stopPropagation();
    try {
      await fetch(`/api/events/${event.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      // ✅ Use queryClient to refetch events
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    } catch (err) {
      console.error("Failed to delete event", err);
      toast({
        title: "Delete failed",
        description: "Could not delete event",
        variant: "destructive"
      });
    }
  }}
  className="bg-red-500 text-white font-bold retro-border hover:bg-red-600"
  size="sm"
>
  ❌
</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    )}
  </CardContent>
</Card>


        {/* Quick Stats */}
        {events && events.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="retro-border p-4 text-center">
              <div className="text-2xl font-black text-primary">
                {events.length}
              </div>
              <div className="text-sm font-bold text-black">TOTAL EVENTS</div>
            </Card>
            <Card className="retro-border p-4 text-center">
              <div className="text-2xl font-black text-green-600">
                {events.filter(e => new Date(e.datetime) > new Date()).length}
              </div>
              <div className="text-sm font-bold text-black">ACTIVE</div>
            </Card>
            <Card className="retro-border p-4 text-center">
              <div className="text-2xl font-black text-orange-600">
                {events.reduce((sum, e) => sum + (e.participants?.length || 0), 0)}
              </div>
              <div className="text-sm font-bold text-black">TOTAL PARTICIPANTS</div>
            </Card>
            <Card className="retro-border p-4 text-center">
              <div className="text-2xl font-black text-blue-600">
                {events.filter(e => e.allowLocationSharing).length}
              </div>
              <div className="text-sm font-bold text-black">WITH TRACKING</div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}