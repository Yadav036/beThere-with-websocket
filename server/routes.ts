import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./prisma-storage";
import { insertUserSchema, insertEventSchema, insertEventInviteSchema } from "@shared/schema";
import { calculateDistance } from "../client/src/lib/haversine";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Validate environment variables
if (!JWT_SECRET) {
  console.error("JWT_SECRET environment variable is required");
  process.exit(1);
}

if (!GOOGLE_MAPS_API_KEY) {
  console.warn("GOOGLE_MAPS_API_KEY not set - ETA calculations will not work");
}

interface AuthenticatedRequest extends Request {
  user?: { sub: string; email: string };
}

// Google Maps ETA calculation
async function calculateGoogleETA(originLat: number, originLng: number, destLat: number, destLng: number): Promise<number> {
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?` +
      `origin=${originLat},${originLng}&` +
      `destination=${destLat},${destLng}&` +
      `mode=driving&` +
      `key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) {
      console.log('Google Maps API error:', data.status);
      return 0;
    }

    const durationSeconds = data.routes[0].legs[0].duration.value;
    return Math.round(durationSeconds / 60); // Convert to minutes
  } catch (error) {
    console.error('Google Maps ETA calculation failed:', error);
    return 0;
  }
}

function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  console.log('Auth check:', {
    hasAuthHeader: !!authHeader,
    method: req.method,
    path: req.path
  });
  
  let token: string | undefined;
  
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }
  }

  if (!token) {
    console.log('Auth failed: No token provided');
    return res.status(401).json({ error: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET!) as { sub: string; email: string };
    req.user = decoded;
    console.log('Auth successful for user:', decoded.sub);
    next();
  } catch (error) {
    console.log('Auth failed: Invalid token', error instanceof Error ? error.message : 'Unknown error');
    return res.status(403).json({ error: "Invalid token" });
  }
}

function authenticateSocket(token: string): { sub: string; email: string } | null {
  try {
    const cleanToken = token.startsWith('Bearer ') ? token.substring(7) : token;
    const decoded = jwt.verify(cleanToken, JWT_SECRET!) as { sub: string; email: string };
    console.log('Socket auth successful for user:', decoded.sub);
    return decoded;
  } catch (error) {
    console.log('Socket auth failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Socket.IO server setup
  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    cors: {
      origin: process.env.NODE_ENV === 'production' ? false : ["http://localhost:5173", "http://127.0.0.1:5173"],
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['polling', 'websocket']
  });

  // Store Socket.IO connections by user ID and event ID
  const connections = new Map<string, Set<any>>();
  const eventConnections = new Map<string, Set<any>>();

  // Socket.IO middleware for authentication
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      const eventId = socket.handshake.query.eventId as string;

      console.log('Socket.IO auth attempt:', { 
        hasToken: !!token, 
        eventId: eventId || 'none',
        socketId: socket.id
      });

      if (!token) {
        console.log('Socket.IO rejected: No token');
        return next(new Error('Token required'));
      }

      const auth = authenticateSocket(token as string);
      if (!auth) {
        console.log('Socket.IO rejected: Invalid token');
        return next(new Error('Invalid token'));
      }

      // Attach user info to socket
      (socket as any).userId = auth.sub;
      (socket as any).eventId = eventId || undefined;

      console.log(`Socket.IO authenticated: user ${auth.sub}, event ${eventId || 'none'}`);
      next();
    } catch (error) {
      console.error('Socket.IO auth error:', error);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket as any).userId;
    const eventId = (socket as any).eventId;

    console.log(`Socket.IO connected: user ${userId}, event ${eventId || 'none'}, socket ${socket.id}`);

    // Add to user connections
    if (!connections.has(userId)) {
      connections.set(userId, new Set());
    }
    connections.get(userId)!.add(socket);

    // Add to event connections if eventId provided
    if (eventId) {
      if (!eventConnections.has(eventId)) {
        eventConnections.set(eventId, new Set());
      }
      eventConnections.get(eventId)!.add(socket);
    }

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      console.log(`Received ping from user ${userId}`);
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // Handle location updates
    socket.on('location_update', async (data) => {
      try {
        console.log(`Location update from ${userId}:`, data);
        const { eventId, lat, lng } = data;
        
        // Get current participant data for movement detection
        const event = await storage.getEventWithParticipants(eventId, userId);
        if (!event) {
          console.log(`Location update failed: Event ${eventId} not found for user ${userId}`);
          return;
        }

        const currentParticipant = event.userParticipant;
        let isMoving = false;
        let distance = 0;
        let eta = 0;

        // Calculate distance from event location
        if (event.locationLat && event.locationLng) {
          distance = calculateDistance(lat, lng, event.locationLat, event.locationLng);
          
          // Calculate ETA using Google Maps API
          eta = await calculateGoogleETA(lat, lng, event.locationLat, event.locationLng);
        }

        // Detect movement (100m threshold)
        if (currentParticipant?.lastLat && currentParticipant?.lastLng) {
          const movementDistance = calculateDistance(
            lat, lng, 
            currentParticipant.lastLat, 
            currentParticipant.lastLng
          );
          
          const timeDiff = currentParticipant.lastLocationAt 
            ? (Date.now() - new Date(currentParticipant.lastLocationAt).getTime()) / 1000 
            : 0;
          
          // Consider moving if traveled >100m in last 30 seconds
          isMoving = movementDistance > 0.1 && timeDiff < 30;
        }

        // Update participant location
        const updatedParticipant = await storage.updateParticipantLocation(
          eventId, userId, lat, lng, isMoving, eta, distance
        );

        if (updatedParticipant) {
          // Broadcast location update to all event participants
          broadcastToEvent(eventId, 'eta_updated', {
            eventId,
            participantId: userId,
            eta,
            distance,
            isMoving,
            timestamp: new Date().toISOString()
          }, userId);
        }
      } catch (error) {
        console.error('Location update error:', error);
        socket.emit('error', { message: 'Location update failed' });
      }
    });

    // Handle participant joined
    socket.on('participant_joined', async (data) => {
      try {
        const { eventId } = data;
        await storage.joinEvent(eventId, userId);
        
        const participant = await storage.getUser(userId);
        if (participant) {
          broadcastToEvent(eventId, 'participant_joined', {
            eventId,
            participant: {
              id: userId,
              user: participant
            }
          }, userId);
        }
      } catch (error) {
        console.error('Participant join error:', error);
        socket.emit('error', { message: 'Failed to join event' });
      }
    });

    // Handle participant left
    socket.on('participant_left', async (data) => {
      try {
        const { eventId } = data;
        await storage.leaveEvent(eventId, userId);
        
        broadcastToEvent(eventId, 'participant_left', {
          eventId,
          participantId: userId
        }, userId);
      } catch (error) {
        console.error('Participant leave error:', error);
        socket.emit('error', { message: 'Failed to leave event' });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`Socket.IO disconnected: user ${userId}, event ${eventId || 'none'}, reason: ${reason}`);
      
      // Remove from user connections
      if (userId && connections.has(userId)) {
        connections.get(userId)!.delete(socket);
        if (connections.get(userId)!.size === 0) {
          connections.delete(userId);
        }
      }

      // Remove from event connections
      if (eventId && eventConnections.has(eventId)) {
        eventConnections.get(eventId)!.delete(socket);
        if (eventConnections.get(eventId)!.size === 0) {
          eventConnections.delete(eventId);
        }
      }
    });

    socket.on('error', (error) => {
      console.error(`Socket.IO error for user ${userId}:`, error);
    });

    // Send initial ping
    socket.emit('ping', { timestamp: new Date().toISOString() });
  });

  // Broadcast to event participants
  function broadcastToEvent(eventId: string, event: string, data: any, excludeUserId?: string) {
    const eventSockets = eventConnections.get(eventId);
    if (eventSockets) {
      let sentCount = 0;
      eventSockets.forEach(socket => {
        if ((socket as any).userId !== excludeUserId) {
          socket.emit(event, data);
          sentCount++;
        }
      });
      console.log(`Broadcast to event ${eventId}: sent ${event} to ${sentCount} participants`);
    }
  }

  const prisma = new PrismaClient()

  // Auth routes
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { email, username, password } = req.body

      const existingUser = await prisma.user.findUnique({ where: { email } })
      if (existingUser) {
        return res.status(400).json({ error: "User already exists" })
      }

      const existingUsername = await prisma.user.findUnique({ where: { username } })
      if (existingUsername) {
        return res.status(400).json({ error: "Username already taken" })
      }

      const hashedPassword = await bcrypt.hash(password, 10)

      const user = await prisma.user.create({
        data: {
          email,
          username,
          password: hashedPassword
        }
      })

      const token = jwt.sign(
        { sub: user.id, email: user.email },
        JWT_SECRET!,
        { expiresIn: "7d" }
      )

      console.log('User signup successful:', user.username);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username
        },
        token
      })
    } catch (error) {
      console.error('Signup error:', error)
      res.status(400).json({ error: "Invalid input data" })
    }
  })

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      const user = await prisma.user.findUnique({ 
        where: { email } 
      });

      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign(
        { sub: user.id, email: user.email },
        JWT_SECRET!,
        { expiresIn: "7d" }
      );

      console.log('User login successful:', user.username);

      res.json({ 
        user: { 
          id: user.id, 
          email: user.email, 
          username: user.username 
        }, 
        token 
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Event routes
  app.post('/api/events', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      console.log('Creating event for user:', req.user!.sub);
      
      const eventData = insertEventSchema.parse({
        ...req.body,
        datetime: new Date(req.body.datetime),
        creatorId: req.user!.sub,
      });

      const event = await storage.createEvent(eventData);
      console.log('Event created with ID:', event.id);
      
      const eventWithParticipants = await storage.getEventWithParticipants(event.id, req.user!.sub);
      
      res.json(eventWithParticipants);
    } catch (error) {
      console.error('Failed to create event:', error);
      
      if (error instanceof Error) {
        if (error.name === 'ZodError') {
          return res.status(400).json({ 
            error: "Invalid event data", 
            details: error.message 
          });
        }
        
        return res.status(400).json({ 
          error: "Failed to create event", 
          details: error.message 
        });
      }
      
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get('/api/events', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const events = await storage.getUserEvents(req.user!.sub);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to get events" });
    }
  });

  app.get('/api/events/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = req.params.id;
      const userId = req.user!.sub;
      
      console.log('Fetching event:', eventId, 'for user:', userId);
      
      let event = await storage.getEventWithParticipants(eventId, userId);
      
      if (!event) {
        const basicEvent = await storage.getEvent(eventId);
        if (!basicEvent) {
          return res.status(404).json({ error: "Event not found" });
        }
        
        event = {
          ...basicEvent,
          creator: null,
          participants: [],
          isCreator: false
        };
      }
      
      res.json(event);
    } catch (error) {
      console.error('Failed to get event:', error);
      res.status(500).json({ error: "Failed to get event" });
    }
  });

  app.post('/api/events/:id/join', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = req.params.id;
      const userId = req.user!.sub;
      
      console.log('User joining event:', { eventId, userId });
      
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }
      
      const participant = await storage.joinEvent(eventId, userId);
      
      console.log('User successfully joined event:', participant);
      res.json({ message: "Successfully joined event", participant });
      
    } catch (error) {
      console.error('Failed to join event:', error);
      res.status(500).json({ error: "Failed to join event" });
    }
  });

  app.post('/api/events/:id/leave', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const left = await storage.leaveEvent(req.params.id, req.user!.sub);
      if (!left) {
        return res.status(404).json({ error: "Not a participant" });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to leave event" });
    }
  });

  app.get('/api/events/:id/participants', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const participants = await storage.getEventParticipants(req.params.id);
      res.json(participants);
    } catch (error) {
      res.status(500).json({ error: "Failed to get participants" });
    }
  });

  app.delete('/api/events/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const event = await storage.getEvent(req.params.id);

      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.creatorId !== req.user!.sub) {
        return res.status(403).json({ error: "Only the creator can delete this event" });
      }

      await storage.deleteEvent(req.params.id, req.user!.sub);

      broadcastToEvent(req.params.id, 'event_deleted', {
        eventId: req.params.id
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Delete error:", error);
      res.status(500).json({ error: "Failed to delete event" });
    }
  });

  // Other routes
  app.get('/api/directions', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { origin, destination, mode = 'driving' } = req.query;
      
      console.log('Directions API request:', {
        origin,
        destination, 
        mode,
        userId: req.user!.sub,
        timestamp: new Date().toISOString()
      });

      if (!origin || !destination) {
        return res.status(400).json({ error: 'Origin and destination are required' });
      }

      if (!GOOGLE_MAPS_API_KEY) {
        console.error('Google Maps API key not configured');
        return res.status(500).json({ error: 'Google Maps API not configured' });
      }

      const url = `https://maps.googleapis.com/maps/api/directions/json?` +
        `origin=${encodeURIComponent(origin as string)}&` +
        `destination=${encodeURIComponent(destination as string)}&` +
        `mode=${mode}&` +
        `key=${GOOGLE_MAPS_API_KEY}`;

      console.log('Making Google Maps API request...');

      const response = await fetch(url);
      const data = await response.json();

      console.log('Google Maps API response:', {
        status: data.status,
        hasRoutes: !!data.routes?.length,
        hasLegs: !!data.routes?.[0]?.legs?.length
      });

      if (data.status !== 'OK') {
        console.error('Google Maps API error:', data.status, data.error_message);
        return res.status(400).json({ 
          error: `Google Maps API error: ${data.status}`,
          details: data.error_message 
        });
      }

      if (!data.routes?.[0]?.legs?.[0]) {
        console.error('No route found in Google Maps response');
        return res.status(404).json({ error: 'No route found' });
      }

      const route = data.routes[0].legs[0];
      const result = {
        duration: route.duration.value,
        distance: route.distance.value,  
        durationText: route.duration.text,
        distanceText: route.distance.text
      };

      console.log('Directions calculated:', result);

      res.json(result);
    } catch (error) {
      console.error('Directions API error:', error);
      res.status(500).json({ 
        error: 'Failed to get directions',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get('/api/users/search', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const users = await storage.searchUsers(query, req.user!.sub);
      res.json(users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email
      })));
    } catch (error) {
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.post('/api/invites', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const inviteData = insertEventInviteSchema.parse({
        ...req.body,
        inviterId: req.user!.sub
      });

      const invite = await storage.createInvite(inviteData);
      res.json(invite);
    } catch (error) {
      res.status(400).json({ error: "Invalid invite data" });
    }
  });

  app.get('/api/invites', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const invites = await storage.getUserInvites(req.user!.sub);
      res.json(invites);
    } catch (error) {
      res.status(500).json({ error: "Failed to get invites" });
    }
  });

  app.post('/api/invites/:id/accept', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const accepted = await storage.acceptInvite(req.params.id, req.user!.sub);
      if (!accepted) {
        return res.status(404).json({ error: "Invite not found" });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to accept invite" });
    }
  });

  app.post('/api/invites/:id/decline', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const declined = await storage.declineInvite(req.params.id, req.user!.sub);
      if (!declined) {
        return res.status(404).json({ error: "Invite not found" });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to decline invite" });
    }
  });

  return httpServer;
}