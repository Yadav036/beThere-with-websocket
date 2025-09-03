import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const events = pgTable("events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  location: text("location").notNull(),
  locationLat: real("location_lat"),
  locationLng: real("location_lng"),
  datetime: timestamp("datetime").notNull(),
  creatorId: varchar("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  allowLocationSharing: boolean("allow_location_sharing").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const eventParticipants = pgTable("event_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastLat: real("last_lat"),
  lastLng: real("last_lng"),
  lastLocationAt: timestamp("last_location_at"),
  isMoving: boolean("is_moving").default(false),
  estimatedArrival: timestamp("estimated_arrival"),
  distanceToEvent: real("distance_to_event"),
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const eventInvites = pgTable("event_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  inviterId: varchar("inviter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  inviteeId: varchar("invitee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending, accepted, declined
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertEventSchema = createInsertSchema(events).omit({
  id: true,
  createdAt: true,
});

export const insertEventParticipantSchema = createInsertSchema(eventParticipants).omit({
  id: true,
  joinedAt: true,
});

export const insertEventInviteSchema = createInsertSchema(eventInvites).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;

export type EventParticipant = typeof eventParticipants.$inferSelect;
export type InsertEventParticipant = z.infer<typeof insertEventParticipantSchema>;

export type EventInvite = typeof eventInvites.$inferSelect;
export type InsertEventInvite = z.infer<typeof insertEventInviteSchema>;

// Extended types for API responses
export type EventWithParticipants = Event & {
  participants: (EventParticipant & { user: User })[];
  creator: User;
  isCreator?: boolean;
  userParticipant?: EventParticipant;
};

export type ParticipantWithUser = EventParticipant & {
  user: User;
};

// WebSocket message types
export const wsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("location_update"),
    data: z.object({
      eventId: z.string(),
      lat: z.number(),
      lng: z.number(),
      timestamp: z.string(),
    }),
  }),
  z.object({
    type: z.literal("participant_joined"),
    data: z.object({
      eventId: z.string(),
      participant: z.any(),
    }),
  }),
  z.object({
    type: z.literal("participant_left"),
    data: z.object({
      eventId: z.string(),
      participantId: z.string(),
    }),
  }),
  z.object({
    type: z.literal("event_deleted"),
    data: z.object({
      eventId: z.string(),
    }),
  }),
  z.object({
    type: z.literal("eta_updated"),
    data: z.object({
      eventId: z.string(),
      participantId: z.string(),
      eta: z.number(),
      distance: z.number(),
      isMoving: z.boolean(),
    }),
  }),
]);

export type WSMessage = z.infer<typeof wsMessageSchema>;
