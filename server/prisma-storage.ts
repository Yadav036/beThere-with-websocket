import { PrismaClient } from '@prisma/client';
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { IStorage } from "./storage";

const JWT_SECRET = process.env.JWT_SECRET 
const prisma = new PrismaClient();

export class PrismaStorage implements IStorage {
  
  async getUser(id: string) {
    const user = await prisma.user.findUnique({
      where: { id }
    });
    return user || undefined;
  }

  async getUserByEmail(email: string) {
    const user = await prisma.user.findUnique({
      where: { email }
    });
    return user || undefined;
  }

  async createUser(insertUser: { email: string; username: string; password: string }) {
    return await prisma.user.create({
      data: insertUser
    });
  }

  async getUserByUsername(username: string) {
    const user = await prisma.user.findUnique({
      where: { username }
    });
    return user || undefined;
  }

  async searchUsers(query: string, currentUserId: string) {
    const lowerQuery = query.toLowerCase();
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } },
          {
            OR: [
              { username: { contains: lowerQuery, mode: 'insensitive' } },
              { email: { contains: lowerQuery, mode: 'insensitive' } }
            ]
          }
        ]
      },
      take: 10
    });
    return users;
  }

  async authenticateUser(email: string, password: string) {
    const user = await this.getUserByEmail(email);
    if (!user) return null;

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) return null;

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    return { user, token };
  }

  async verifyToken(token: string) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      const user = await this.getUser(decoded.userId);
      return user ? { sub: user.id, email: user.email } : null;
    } catch {
      return null;
    }
  }

  async getEvent(id: string) {
    const event = await prisma.event.findUnique({
      where: { id }
    });
    return event || undefined;
  }

  async getEventWithParticipants(id: string, userId: string) {
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        creator: true,
        participants: {
          include: {
            user: true
          }
        }
      }
    });

    if (!event) return undefined;

    // Check if user is creator or participant
    const isCreator = event.creatorId === userId;
    const isParticipant = event.participants.some(p => p.userId === userId);

    if (!isCreator && !isParticipant) return undefined;

    return {
      ...event,
      isCreator,
      participants: event.participants.map(p => ({
        ...p,
        user: p.user
      }))
    } as any;
  }

  async getUserEvents(userId: string) {
    // Get events where user is creator or participant
    const createdEvents = await prisma.event.findMany({
      where: { creatorId: userId },
      include: {
        creator: true,
        participants: {
          include: {
            user: true
          }
        }
      }
    });

    const participantEvents = await prisma.event.findMany({
      where: {
        participants: {
          some: { userId }
        }
      },
      include: {
        creator: true,
        participants: {
          include: {
            user: true
          }
        }
      }
    });

    // Combine and dedupe events
    const allEvents = [...createdEvents, ...participantEvents];
    const uniqueEvents = allEvents.filter((event, index, self) => 
      index === self.findIndex(e => e.id === event.id)
    );

    return uniqueEvents.map(event => ({
      ...event,
      isCreator: event.creatorId === userId,
      participants: event.participants.map(p => ({
        ...p,
        user: p.user
      }))
    }));
  }

  async createEvent(insertEvent: {
    name: string;
    description?: string;
    location: string;
    locationLat?: number;
    locationLng?: number;
    datetime: Date;
    creatorId: string;
    allowLocationSharing?: boolean;
  }) {
    const event = await prisma.event.create({
      data: {
        ...insertEvent,
        description: insertEvent.description || null,
        locationLat: insertEvent.locationLat || null,
        locationLng: insertEvent.locationLng || null,
        allowLocationSharing: insertEvent.allowLocationSharing ?? true,
      }
    });

    // Auto-join creator as participant
    await this.joinEvent(event.id, insertEvent.creatorId);

    return event;
  }

  async deleteEvent(id: string, userId: string): Promise<boolean> {
    const event = await this.getEvent(id);
    if (!event || event.creatorId !== userId) return false;

    await prisma.event.delete({
      where: { id }
    });
    return true;
  }

  async joinEvent(eventId: string, userId: string) {
    // Check if already a participant
    const existing = await prisma.eventParticipant.findFirst({
      where: { eventId, userId }
    });

    if (existing) return existing;

    return await prisma.eventParticipant.create({
      data: { eventId, userId }
    });
  }

  async leaveEvent(eventId: string, userId: string): Promise<boolean> {
    const result = await prisma.eventParticipant.deleteMany({
      where: { eventId, userId }
    });
    return result.count > 0;
  }

  async getEventParticipants(eventId: string) {
    const participants = await prisma.eventParticipant.findMany({
      where: { eventId },
      include: {
        user: true
      }
    });
    return participants;
  }

  async updateParticipantLocation(
    eventId: string, 
    userId: string, 
    lat: number, 
    lng: number, 
    isMoving?: boolean, 
    eta?: number, 
    distance?: number
  ) {
    const participant = await prisma.eventParticipant.findFirst({
      where: { eventId, userId }
    });

    if (!participant) return undefined;

    return await prisma.eventParticipant.update({
      where: { id: participant.id },
      data: {
        lastLat: lat,
        lastLng: lng,
        lastLocationAt: new Date(),
        isMoving: isMoving ?? false,
        estimatedArrival: eta ? new Date(eta) : null,
        distanceToEvent: distance || null,
      }
    });
  }

  async createInvite(insertInvite: {
    eventId: string;
    inviterId: string;
    inviteeId: string;
    status?: string;
  }) {
    return await prisma.eventInvite.create({
      data: {
        ...insertInvite,
        status: insertInvite.status || 'pending'
      }
    });
  }

  async getUserInvites(userId: string) {
    const invites = await prisma.eventInvite.findMany({
      where: { 
        inviteeId: userId,
        status: 'pending'
      },
      include: {
        event: true,
        inviter: true
      }
    });

    return invites;
  }

  async acceptInvite(inviteId: string, userId: string): Promise<boolean> {
    const invite = await prisma.eventInvite.findUnique({
      where: { id: inviteId }
    });

    if (!invite || invite.inviteeId !== userId) return false;

    await prisma.eventInvite.update({
      where: { id: inviteId },
      data: { status: 'accepted' }
    });

    // Auto-join the event
    await this.joinEvent(invite.eventId, userId);
    return true;
  }

  async declineInvite(inviteId: string, userId: string): Promise<boolean> {
    const invite = await prisma.eventInvite.findUnique({
      where: { id: inviteId }
    });

    if (!invite || invite.inviteeId !== userId) return false;

    await prisma.eventInvite.update({
      where: { id: inviteId },
      data: { status: 'declined' }
    });

    return true;
  }
}


export const storage = new PrismaStorage();