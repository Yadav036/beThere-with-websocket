# Stage 1: Build
FROM node:18-bullseye AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy project files
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build frontend + backend
RUN npm run build

# Stage 2: Run (production)
FROM node:18-bullseye-slim

WORKDIR /app

# Copy built files + node_modules + Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 5001

CMD ["npm", "start"]
