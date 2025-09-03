-- CreateTable
CREATE TABLE "public"."users" (
    "id" VARCHAR NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."events" (
    "id" VARCHAR NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT NOT NULL,
    "location_lat" REAL,
    "location_lng" REAL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "creator_id" VARCHAR NOT NULL,
    "allow_location_sharing" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_participants" (
    "id" VARCHAR NOT NULL DEFAULT gen_random_uuid(),
    "event_id" VARCHAR NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "last_lat" REAL,
    "last_lng" REAL,
    "last_location_at" TIMESTAMP(3),
    "is_moving" BOOLEAN NOT NULL DEFAULT false,
    "estimated_arrival" TIMESTAMP(3),
    "distance_to_event" REAL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_invites" (
    "id" VARCHAR NOT NULL DEFAULT gen_random_uuid(),
    "event_id" VARCHAR NOT NULL,
    "inviter_id" VARCHAR NOT NULL,
    "invitee_id" VARCHAR NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "public"."users"("username");

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_participants" ADD CONSTRAINT "event_participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_participants" ADD CONSTRAINT "event_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_invites" ADD CONSTRAINT "event_invites_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_invites" ADD CONSTRAINT "event_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_invites" ADD CONSTRAINT "event_invites_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
