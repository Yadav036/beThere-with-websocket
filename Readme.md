# Overview

BeThere is a real-time location-sharing event management application that allows users to create events, invite participants, and track everyone's location and arrival status in real-time. The app combines social event coordination with live location tracking to help groups stay connected during meetups and gatherings.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
The application uses a modern React-based single-page application (SPA) architecture:
- **React 18** with TypeScript for type-safe component development
- **Wouter** for lightweight client-side routing instead of React Router
- **TanStack Query** for server state management and caching
- **React Hook Form** with Zod validation for form handling
- **shadcn/ui** component library built on Radix UI primitives for consistent UI
- **Tailwind CSS** for utility-first styling with custom design tokens

The frontend follows a hook-based architecture with custom hooks for:
- Authentication state management (`useAuth`)
- WebSocket connections (`useWebSocket`) 
- Real-time location reporting (`useLocationReporter`)
- Mobile-responsive behavior (`useIsMobile`)

## Backend Architecture
Express.js server with TypeScript providing:
- **RESTful API** for standard CRUD operations (events, users, invitations)
- **WebSocket server** for real-time location updates and event coordination
- **JWT-based authentication** with secure token management
- **Middleware-based request handling** with logging and error handling
- **Memory storage implementation** with interface for easy database swapping

The server uses a layered architecture separating:
- Route handlers for HTTP endpoints
- Storage abstraction layer for data operations
- WebSocket management for real-time features
- Authentication middleware for protected routes

## Database Design
Currently implements in-memory storage with a well-defined interface for PostgreSQL migration:
- **Users**: Authentication and profile data
- **Events**: Event details with location coordinates and settings
- **Event Participants**: User participation with real-time location data
- **Event Invites**: Invitation system with status tracking

The schema uses Drizzle ORM with PostgreSQL dialect, enabling easy database switching from the current memory implementation.

## Real-time Features
WebSocket-based real-time communication for:
- Live location updates from participants
- Event status changes and notifications
- Participant join/leave notifications
- Connection status monitoring with automatic reconnection

## Location Services
Geolocation integration providing:
- Haversine formula for accurate distance calculations
- ETA estimation based on distance and average travel speed
- High-accuracy GPS tracking with configurable update intervals
- Participant status tracking (moving, stationary, arrived)

## Authentication & Security
JWT-based authentication system with:
- Secure password hashing using bcryptjs
- Token-based API authentication
- WebSocket authentication via query parameters
- Protected routes with middleware validation

# External Dependencies

## Core Framework Dependencies
- **React 18** - Frontend UI framework
- **Express.js** - Backend web server framework
- **TypeScript** - Type safety across the application
- **Vite** - Development server and build tool

## Database & ORM
- **Drizzle ORM** - Type-safe database operations
- **@neondatabase/serverless** - PostgreSQL database driver
- **PostgreSQL** - Production database (configured but not yet active)

## Authentication & Security
- **jsonwebtoken** - JWT token generation and verification
- **bcryptjs** - Password hashing and validation

## Real-time Communication
- **ws (WebSocket)** - WebSocket server implementation for real-time features

## UI Component Library
- **@radix-ui/* packages** - Headless UI primitives for accessibility
- **shadcn/ui** - Pre-built component library
- **Tailwind CSS** - Utility-first styling framework
- **Lucide React** - Icon library

## State Management & Forms
- **@tanstack/react-query** - Server state management and caching
- **React Hook Form** - Form handling and validation
- **@hookform/resolvers** - Form validation resolvers
- **Zod** - Schema validation library

## Development Tools
- **@replit/vite-plugin-runtime-error-modal** - Development error handling
- **@replit/vite-plugin-cartographer** - Replit development integration

## Location & Utilities
- **date-fns** - Date manipulation and formatting
- **clsx & tailwind-merge** - Conditional styling utilities
- **class-variance-authority** - Component variant management