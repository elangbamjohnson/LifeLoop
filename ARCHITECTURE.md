# ARCHITECTURE.md

## Overview
LifeLoop is built as a Modular Monolith. The system is designed to gracefully mature into a more complex microservice architecture, but starts unified to reduce deployment complexity.

## Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL (Cloud SQL) via Drizzle ORM
- **Testing**: Vitest (Unit & Integration)
- **Logging**: Pino (Structured JSON logging)

## System Boundaries

### 1. Presentation Layer (`/src/client`)
- Strict separation from business logic.
- Maintains UI state and layout structure.
- Communicates with the API exclusively via REST.

### 2. API Layer (`/src/server/api`)
- Express routing controllers.
- Responsibilities: Route definitions, rate limiting, Request/Response parsing, HTTP status codes.
- Relies on Zod for payload validation.

### 3. Service & Domain Layer (`/src/server/services`)
- Core business logic.
- Interfaces with AI Providers and Data Repositories.

### 4. Data Layer (`/src/server/repositories` & `/src/db`)
- Houses database connection config, schemas, and migrations.
- Includes abstraction interfaces for Repositories so that concrete databases (PostgreSQL) can be swapped or mocked in memory for tests.

## Security Controls
- Passwords hashed using bcrypt.
- Session tokens managed via HTTP-only, SameSite=Lax, secure cookies.
- Rate limiting implemented on authentication endpoints to deter brute-force attacks.
- Strict multi-tenant isolation enforced at the database query level (always checking `user_id`).
