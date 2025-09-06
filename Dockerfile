# Stage 1: Build
FROM node:18-bullseye AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy project files
COPY . .

# Build frontend + backend
RUN npm run build

# Stage 2: Run (production)
FROM node:18-bullseye-slim

WORKDIR /app

# Copy only built files + package.json
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# Install only production deps
RUN npm install 

EXPOSE 5001

CMD ["npm", "start"]
