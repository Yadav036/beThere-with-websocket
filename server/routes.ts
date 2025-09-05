import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./prisma-storage";
import { insertUserSchema, insertEventSchema, insertEventInviteSchema, wsMessageSchema, type WSMessage } from "@shared/schema";
import { calculateDistance } from "../client/src/lib/haversine";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

interface AuthenticatedRequest extends Request {
  user?: { sub: string; email: string };
}

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  eventId?: string;
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
  
  console.log('🔍 Auth check:', {
    hasAuthHeader: !!authHeader,
    authHeaderPreview: authHeader ? `${authHeader.substring(0, 20)}...` : 'none',
    method: req.method,
    path: req.path
  });
  
  let token: string | undefined;
  
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove "Bearer " prefix
    } else {
      token = authHeader; // Direct token (fallback)
    }
  }

  if (!token) {
    console.log('❌ Auth failed: No token provided');
    return res.status(401).json({ error: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; email: string };
    req.user = decoded;
    console.log('✅ Auth successful for user:', decoded.sub);
    next();
  } catch (error) {
    console.log('❌ Auth failed: Invalid token', error instanceof Error ? error.message : 'Unknown error');
    return res.status(403).json({ error: "Invalid token" });
  }
}

function authenticateWebSocket(token: string): { sub: string; email: string } | null {
  try {
    const cleanToken = token.startsWith('Bearer ') ? token.substring(7) : token;
    const decoded = jwt.verify(cleanToken, JWT_SECRET) as { sub: string; email: string };
    console.log('✅ WebSocket auth successful for user:', decoded.sub);
    return decoded;
  } catch (error) {
    console.log('❌ WebSocket auth failed:', error.message);
    return null;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // WebSocket server setup
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws',
    verifyClient: (info: any) => {
      const url = new URL(info.req.url!, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');
      console.log('🔍 WebSocket verifyClient:', { hasToken: !!token });
      return token ? authenticateWebSocket(token) !== null : false;
    }
  });

  // Store WebSocket connections by user ID and event ID
  const connections = new Map<string, Set<AuthenticatedWebSocket>>();
  const eventConnections = new Map<string, Set<AuthenticatedWebSocket>>();

  wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const eventId = url.searchParams.get('eventId');

    console.log('🔌 WebSocket connection attempt:', { 
      hasToken: !!token, 
      eventId: eventId || 'none',
      userAgent: req.headers['user-agent']
    });

    if (!token) {
      console.log('❌ WebSocket rejected: No token');
      ws.close(1008, 'Token required');
      return;
    }

    const auth = authenticateWebSocket(token);
    if (!auth) {
      console.log('❌ WebSocket rejected: Invalid token');
      ws.close(1008, 'Invalid token');
      return;
    }

    ws.userId = auth.sub;
    ws.eventId = eventId || undefined;

    // Add to user connections
    if (!connections.has(auth.sub)) {
      connections.set(auth.sub, new Set());
    }
    connections.get(auth.sub)!.add(ws);

    // Add to event connections if eventId provided
    if (eventId) {
      if (!eventConnections.has(eventId)) {
        eventConnections.set(eventId, new Set());
      }
      eventConnections.get(eventId)!.add(ws);
    }

    console.log(`✅ WebSocket connected: user ${auth.sub}, event ${eventId || 'none'}`);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'ping') {
          console.log(`💓 Received ping from user ${ws.userId}`);
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          return;
        }
        
        if (message.type === 'pong') {
          console.log(`💓 Received pong from user ${ws.userId}`);
          return;
        }
        
        const parsedMessage = wsMessageSchema.parse(message);
        await handleWebSocketMessage(ws, parsedMessage, connections, eventConnections);
        
      } catch (error) {
        if (error.name === 'ZodError') {
          console.error('❌ WebSocket message validation error:', {
            userId: ws.userId,
            messageType: JSON.parse(data.toString())?.type || 'unknown',
            errors: error.issues
          });
          ws.send(JSON.stringify({ 
            error: 'Invalid message format', 
            details: error.issues 
          }));
        } else {
          console.error('❌ WebSocket message processing error:', error);
          ws.send(JSON.stringify({ error: 'Message processing failed' }));
        }
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket disconnected: user ${ws.userId}, event ${ws.eventId || 'none'}, code: ${code}, reason: ${reason || 'No reason'}`);
      
      // Remove from user connections
      if (ws.userId && connections.has(ws.userId)) {
        connections.get(ws.userId)!.delete(ws);
        if (connections.get(ws.userId)!.size === 0) {
          connections.delete(ws.userId);
        }
      }

      // Remove from event connections
      if (ws.eventId && eventConnections.has(ws.eventId)) {
        eventConnections.get(ws.eventId)!.delete(ws);
        if (eventConnections.get(ws.eventId)!.size === 0) {
          eventConnections.delete(ws.eventId);
        }
      }
    });

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for user ${ws.userId}:`, error);
    });

    // Send initial ping
    ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
  });

  // Broadcast to event participants
  function broadcastToEvent(eventId: string, message: any, excludeUserId?: string) {
    const eventSockets = eventConnections.get(eventId);
    if (eventSockets) {
      let sentCount = 0;
      eventSockets.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN && ws.userId !== excludeUserId) {
          ws.send(JSON.stringify(message));
          sentCount++;
        }
      });
      console.log(`📡 Broadcast to event ${eventId}: sent to ${sentCount} participants`);
    }
  }

  // Handle WebSocket messages
  async function handleWebSocketMessage(
    ws: AuthenticatedWebSocket, 
    message: WSMessage, 
    connections: Map<string, Set<AuthenticatedWebSocket>>,
    eventConnections: Map<string, Set<AuthenticatedWebSocket>>
  ) {
    const userId = ws.userId!;
    console.log(`📨 WebSocket message from ${userId}:`, message.type);

    switch (message.type) {
      case 'location_update':
        {
          const { eventId, lat, lng } = message.data;
          
          // Get current participant data for movement detection
          const event = await storage.getEventWithParticipants(eventId, userId);
          if (!event) {
            console.log(`❌ Location update failed: Event ${eventId} not found for user ${userId}`);
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
            broadcastToEvent(eventId, {
              type: 'eta_updated',
              data: {
                eventId,
                participantId: userId,
                eta,
                distance,
                isMoving,
                timestamp: new Date().toISOString()
              }
            }, userId);
          }
        }
        break;

      case 'participant_joined':
        {
          const { eventId } = message.data;
          await storage.joinEvent(eventId, userId);
          
          const participant = await storage.getUser(userId);
          if (participant) {
            broadcastToEvent(eventId, {
              type: 'participant_joined',
              data: {
                eventId,
                participant: {
                  id: userId,
                  user: participant
                }
              }
            }, userId);
          }
        }
        break;

      case 'participant_left':
        {
          const { eventId } = message.data;
          await storage.leaveEvent(eventId, userId);
          
          broadcastToEvent(eventId, {
            type: 'participant_left',
            data: {
              eventId,
              participantId: userId
            }
          }, userId);
        }
        break;
    }
  }

  const prisma = new PrismaClient()

  // Auth routes - These were already correct
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { email, username, password } = req.body

      // Check if user already exists by email
      const existingUser = await prisma.user.findUnique({ where: { email } })
      if (existingUser) {
        return res.status(400).json({ error: "User already exists" })
      }

      // Check if username already exists
      const existingUsername = await prisma.user.findUnique({ where: { username } })
      if (existingUsername) {
        return res.status(400).json({ error: "Username already taken" })
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10)

      // Create new user
      const user = await prisma.user.create({
        data: {
          email,
          username,
          password: hashedPassword
        }
      })

      // Generate JWT token
      const token = jwt.sign(
        { sub: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      )

      console.log('✅ User signup successful:', user.username);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username
        },
        token
      })
    } catch (error) {
      console.error('❌ Signup error:', error)
      res.status(400).json({ error: "Invalid input data" })
    }
  })
  // Google Directions API route
app.get('/api/directions', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { origin, destination, mode = 'driving' } = req.query;
    
    console.log('🗺️ Directions API request:', {
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
      console.error('❌ Google Maps API key not configured');
      return res.status(500).json({ error: 'Google Maps API not configured' });
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?` +
      `origin=${encodeURIComponent(origin as string)}&` +
      `destination=${encodeURIComponent(destination as string)}&` +
      `mode=${mode}&` +
      `key=${GOOGLE_MAPS_API_KEY}`;

    console.log('🌐 Making Google Maps API request...');

    const response = await fetch(url);
    const data = await response.json();

    console.log('🌐 Google Maps API response:', {
      status: data.status,
      hasRoutes: !!data.routes?.length,
      hasLegs: !!data.routes?.[0]?.legs?.length
    });

    if (data.status !== 'OK') {
      console.error('❌ Google Maps API error:', data.status, data.error_message);
      return res.status(400).json({ 
        error: `Google Maps API error: ${data.status}`,
        details: data.error_message 
      });
    }

    if (!data.routes?.[0]?.legs?.[0]) {
      console.error('❌ No route found in Google Maps response');
      return res.status(404).json({ error: 'No route found' });
    }

    const route = data.routes[0].legs[0];
    const result = {
      duration: route.duration.value, // seconds
      distance: route.distance.value, // meters  
      durationText: route.duration.text,
      distanceText: route.distance.text
    };

    console.log('✅ Directions calculated:', result);

    res.json(result);
  } catch (error) {
    console.error('❌ Directions API error:', error);
    res.status(500).json({ 
      error: 'Failed to get directions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      // Find user by email
      const user = await prisma.user.findUnique({ 
        where: { email } 
      });

      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Generate JWT token
      const token = jwt.sign(
        { sub: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      console.log('✅ User login successful:', user.username);

      res.json({ 
        user: { 
          id: user.id, 
          email: user.email, 
          username: user.username 
        }, 
        token 
      });
    } catch (error) {
      console.error('❌ Login error:', error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // All other routes remain the same - they were already using the correct authenticateToken middleware
  app.get('/api/events', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const events = await storage.getUserEvents(req.user!.sub);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to get events" });
    }
  });

  app.post('/api/events', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      console.log('📍 Creating event for user:', req.user!.sub);
      console.log('📍 Request body:', JSON.stringify(req.body, null, 2));
      
      // Validate and parse the event data
      const eventData = insertEventSchema.parse({
        ...req.body,
        datetime: new Date(req.body.datetime), // convert string to Date
        creatorId: req.user!.sub,
      });

      console.log('📍 Parsed event data:', JSON.stringify(eventData, null, 2));

      // Create the event
      const event = await storage.createEvent(eventData);
      console.log('✅ Event created with ID:', event.id);
      
      // Get the event with participants
      const eventWithParticipants = await storage.getEventWithParticipants(event.id, req.user!.sub);
      
      res.json(eventWithParticipants);
    } catch (error) {
      console.error('❌ Failed to create event:', error);
      
      // Better error handling
      if (error instanceof Error) {
        // Zod validation errors
        if (error.name === 'ZodError') {
          return res.status(400).json({ 
            error: "Invalid event data", 
            details: error.message 
          });
        }
        
        // Other errors
        return res.status(400).json({ 
          error: "Failed to create event", 
          details: error.message 
        });
      }
      
      res.status(500).json({ error: "Internal server error" });
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

    // ✅ Pass both id and userId
    await storage.deleteEvent(req.params.id, req.user!.sub);

    broadcastToEvent(req.params.id, {
      type: 'event_deleted',
      data: {
        eventId: req.params.id
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error); // Add logging
    res.status(500).json({ error: "Failed to delete event" });
  }
});


  // GET single event by ID - anyone with auth can view any event
  app.get('/api/events/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = req.params.id;
      const userId = req.user!.sub;
      
      console.log('📍 Fetching event:', eventId, 'for user:', userId);
      
      // First try to get event with participants if user is already involved
      let event = await storage.getEventWithParticipants(eventId, userId);
      
      // If not found (user not creator/participant), get basic event info
      if (!event) {
        const basicEvent = await storage.getEvent(eventId);
        if (!basicEvent) {
          return res.status(404).json({ error: "Event not found" });
        }
        
        // Return basic event info - user can join via separate endpoint
        event = {
          ...basicEvent,
          creator: null, // We'll need to fetch this separately if needed
          participants: [],
          isCreator: false
        };
      }
      
      res.json(event);
    } catch (error) {
      console.error('❌ Failed to get event:', error);
      res.status(500).json({ error: "Failed to get event" });
    }
  });

  // POST join event - adds user as participant when they visit event URL
  app.post('/api/events/:id/join', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = req.params.id;
      const userId = req.user!.sub;
      
      console.log('🤝 User joining event:', { eventId, userId });
      
      // Check if event exists
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }
      
      // Add user as participant (your joinEvent method handles duplicates)
      const participant = await storage.joinEvent(eventId, userId);
      
      console.log('✅ User successfully joined event:', participant);
      res.json({ message: "Successfully joined event", participant });
      
    } catch (error) {
      console.error('❌ Failed to join event:', error);
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

  // User search route
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

  // Invite routes
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