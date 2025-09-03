import { type User, type InsertUser, type Event, type InsertEvent, type EventParticipant, type InsertEventParticipant, type EventInvite, type InsertEventInvite, type EventWithParticipants, type ParticipantWithUser } from "@shared/schema";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  authenticateUser(email: string, password: string): Promise<{ user: User; token: string } | null>;
  verifyToken(token: string): Promise<{ sub: string; email: string } | null>;
  searchUsers(query: string, currentUserId: string): Promise<User[]>;

  // Event methods
  getEvent(id: string): Promise<Event | undefined>;
  getEventWithParticipants(id: string, userId?: string): Promise<EventWithParticipants | undefined>;
  getUserEvents(userId: string): Promise<EventWithParticipants[]>;
  createEvent(event: InsertEvent): Promise<Event>;
  deleteEvent(id: string, userId: string): Promise<boolean>;

  // Participant methods
  getEventParticipants(eventId: string): Promise<ParticipantWithUser[]>;
  joinEvent(eventId: string, userId: string): Promise<EventParticipant>;
  leaveEvent(eventId: string, userId: string): Promise<boolean>;
  updateParticipantLocation(eventId: string, userId: string, lat: number, lng: number, isMoving?: boolean, eta?: number, distance?: number): Promise<EventParticipant | undefined>;

  // Invite methods
  createInvite(invite: InsertEventInvite): Promise<EventInvite>;
  getUserInvites(userId: string): Promise<(EventInvite & { event: Event; inviter: User })[]>;
  acceptInvite(inviteId: string, userId: string): Promise<boolean>;
  declineInvite(inviteId: string, userId: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private events: Map<string, Event>;
  private eventParticipants: Map<string, EventParticipant>;
  private eventInvites: Map<string, EventInvite>;

  constructor() {
    this.users = new Map();
    this.events = new Map();
    this.eventParticipants = new Map();
    this.eventInvites = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.email === email);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const hashedPassword = await bcrypt.hash(insertUser.password, 10);
    const user: User = {
      ...insertUser,
      id,
      password: hashedPassword,
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async authenticateUser(email: string, password: string): Promise<{ user: User; token: string } | null> {
    const user = await this.getUserByEmail(email);
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return null;

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return { user, token };
  }

  async verifyToken(token: string): Promise<{ sub: string; email: string } | null> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; email: string };
      return decoded;
    } catch {
      return null;
    }
  }

  async searchUsers(query: string, currentUserId: string): Promise<User[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.users.values())
      .filter(user => 
        user.id !== currentUserId &&
        (user.username.toLowerCase().includes(lowerQuery) || 
         user.email.toLowerCase().includes(lowerQuery))
      )
      .slice(0, 10);
  }

  async getEvent(id: string): Promise<Event | undefined> {
    return this.events.get(id);
  }

  async getEventWithParticipants(id: string, userId?: string): Promise<EventWithParticipants | undefined> {
    const event = this.events.get(id);
    if (!event) return undefined;

    const creator = this.users.get(event.creatorId);
    if (!creator) return undefined;

    const participants = Array.from(this.eventParticipants.values())
      .filter(p => p.eventId === id)
      .map(p => {
        const user = this.users.get(p.userId);
        return user ? { ...p, user } : null;
      })
      .filter(Boolean) as ParticipantWithUser[];

    const userParticipant = userId ? participants.find(p => p.userId === userId) : undefined;

    return {
      ...event,
      participants,
      creator,
      isCreator: userId === event.creatorId,
      userParticipant,
    };
  }

  async getUserEvents(userId: string): Promise<EventWithParticipants[]> {
    const userParticipantEvents = Array.from(this.eventParticipants.values())
      .filter(p => p.userId === userId)
      .map(p => p.eventId);

    const createdEvents = Array.from(this.events.values())
      .filter(e => e.creatorId === userId)
      .map(e => e.id);

    const allEventIds = Array.from(new Set([...userParticipantEvents, ...createdEvents]));

    const events = await Promise.all(
      allEventIds.map(id => this.getEventWithParticipants(id, userId))
    );

    return events.filter(Boolean) as EventWithParticipants[];
  }

  async createEvent(insertEvent: InsertEvent): Promise<Event> {
    const id = randomUUID();
    const event: Event = {
      ...insertEvent,
      description: insertEvent.description || null,
      locationLat: insertEvent.locationLat || null,
      locationLng: insertEvent.locationLng || null,
      allowLocationSharing: insertEvent.allowLocationSharing ?? true,
      id,
      createdAt: new Date(),
    };
    this.events.set(id, event);

    // Auto-join creator as participant
    await this.joinEvent(id, insertEvent.creatorId);

    return event;
  }

  async deleteEvent(id: string, userId: string): Promise<boolean> {
    const event = this.events.get(id);
    if (!event || event.creatorId !== userId) return false;

    // Delete all related participants and invites
    Array.from(this.eventParticipants.keys()).forEach(key => {
      const participant = this.eventParticipants.get(key);
      if (participant?.eventId === id) {
        this.eventParticipants.delete(key);
      }
    });

    Array.from(this.eventInvites.keys()).forEach(key => {
      const invite = this.eventInvites.get(key);
      if (invite?.eventId === id) {
        this.eventInvites.delete(key);
      }
    });

    this.events.delete(id);
    return true;
  }

  async getEventParticipants(eventId: string): Promise<ParticipantWithUser[]> {
    const participants = Array.from(this.eventParticipants.values())
      .filter(p => p.eventId === eventId)
      .map(p => {
        const user = this.users.get(p.userId);
        return user ? { ...p, user } : null;
      })
      .filter(Boolean) as ParticipantWithUser[];

    return participants;
  }

  async joinEvent(eventId: string, userId: string): Promise<EventParticipant> {
    const existingKey = Array.from(this.eventParticipants.keys()).find(key => {
      const p = this.eventParticipants.get(key);
      return p?.eventId === eventId && p?.userId === userId;
    });

    if (existingKey) {
      return this.eventParticipants.get(existingKey)!;
    }

    const id = randomUUID();
    const participant: EventParticipant = {
      id,
      eventId,
      userId,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
      isMoving: false,
      estimatedArrival: null,
      distanceToEvent: null,
      joinedAt: new Date(),
    };

    this.eventParticipants.set(id, participant);
    return participant;
  }

  async leaveEvent(eventId: string, userId: string): Promise<boolean> {
    const key = Array.from(this.eventParticipants.keys()).find(key => {
      const p = this.eventParticipants.get(key);
      return p?.eventId === eventId && p?.userId === userId;
    });

    if (key) {
      this.eventParticipants.delete(key);
      return true;
    }
    return false;
  }

  async updateParticipantLocation(
    eventId: string, 
    userId: string, 
    lat: number, 
    lng: number, 
    isMoving: boolean = false, 
    eta?: number, 
    distance?: number
  ): Promise<EventParticipant | undefined> {
    const key = Array.from(this.eventParticipants.keys()).find(key => {
      const p = this.eventParticipants.get(key);
      return p?.eventId === eventId && p?.userId === userId;
    });

    if (!key) {
      // Auto-join if not already joined
      const participant = await this.joinEvent(eventId, userId);
      return this.updateParticipantLocation(eventId, userId, lat, lng, isMoving, eta, distance);
    }

    const participant = this.eventParticipants.get(key)!;
    const updatedParticipant: EventParticipant = {
      ...participant,
      lastLat: lat,
      lastLng: lng,
      lastLocationAt: new Date(),
      isMoving,
      distanceToEvent: distance || participant.distanceToEvent,
      estimatedArrival: eta ? new Date(Date.now() + eta * 60 * 1000) : participant.estimatedArrival,
    };

    this.eventParticipants.set(key, updatedParticipant);
    return updatedParticipant;
  }

  async createInvite(insertInvite: InsertEventInvite): Promise<EventInvite> {
    const id = randomUUID();
    const invite: EventInvite = {
      ...insertInvite,
      status: insertInvite.status || 'pending',
      id,
      createdAt: new Date(),
    };
    this.eventInvites.set(id, invite);
    return invite;
  }

  async getUserInvites(userId: string): Promise<(EventInvite & { event: Event; inviter: User })[]> {
    const invites = Array.from(this.eventInvites.values())
      .filter(invite => invite.inviteeId === userId && invite.status === "pending")
      .map(invite => {
        const event = this.events.get(invite.eventId);
        const inviter = this.users.get(invite.inviterId);
        return event && inviter ? { ...invite, event, inviter } : null;
      })
      .filter(Boolean) as (EventInvite & { event: Event; inviter: User })[];

    return invites;
  }

  async acceptInvite(inviteId: string, userId: string): Promise<boolean> {
    const invite = this.eventInvites.get(inviteId);
    if (!invite || invite.inviteeId !== userId) return false;

    const updatedInvite: EventInvite = { ...invite, status: "accepted" };
    this.eventInvites.set(inviteId, updatedInvite);

    // Auto-join the event
    await this.joinEvent(invite.eventId, userId);
    return true;
  }

  async declineInvite(inviteId: string, userId: string): Promise<boolean> {
    const invite = this.eventInvites.get(inviteId);
    if (!invite || invite.inviteeId !== userId) return false;

    const updatedInvite: EventInvite = { ...invite, status: "declined" };
    this.eventInvites.set(inviteId, updatedInvite);
    return true;
  }
}

export const storage = new MemStorage();
