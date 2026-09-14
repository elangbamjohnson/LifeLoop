# LifeLoop — Personal Life Operating System

> "Never forget what matters."

LifeLoop is an intelligent "life admin" system that captures information and converts it into useful, structured context. It acts as a personal memory and obligation layer, following the core loop: **CAPTURE → UNDERSTAND → STRUCTURE → REMEMBER → REMIND → EVENTUALLY ACT**.

## 1. Project Architecture

The MVP is built as a **Modular Monolith** prioritizing code separation, security, and future portability to native mobile platforms.

- **Frontend (Web MVP)**: React 19 + TypeScript + Vite + Tailwind CSS. Designed to be strictly presentation-focused, allowing easy translation to React Native or Flutter in the future.
- **Backend**: Node.js + Express + TypeScript.
- **Database**: PostgreSQL (relational core with JSONB for flexible metadata).

## 2. Repository Structure

```text
/src
  /client               # Frontend React Application
    /components         # Reusable UI elements (Buttons, Inputs)
    /features           # Feature-based modules (Capture, Dashboard, Items)
    /hooks              # Custom React hooks
    /services           # API client and external interactions
    /types              # Shared frontend types
  /server               # Backend Express Application
    /api                # Express routes and controllers
    /services           # Core business logic (AI parsing, scheduling)
    /db                 # Database connections, schema, and migrations
    /providers          # External provider abstractions (AI, Auth)
  /shared               # Shared code between client and server
    /types              # Domain models, API contracts (Zod schemas)
    /constants          # System-wide constants
```

## 3. Database Schema

The core schema utilizes a stable relational model enhanced with JSONB for dynamic metadata.

- **`users`**: `id`, `email`, `password_hash`, `created_at`, `settings`
- **`captures`**: `id`, `user_id`, `type` (text, image, audio), `raw_payload`, `status` (pending, processed, failed), `created_at`
- **`items`**: `id`, `user_id`, `type` (task, event, bill, document, person), `title`, `description`, `status`, `metadata` (JSONB)
- **`dates_and_reminders`**: `id`, `item_id`, `date_type` (due_date, reminder, renewal), `timestamp`, `is_resolved`
- **`relationships`**: `source_item_id`, `target_item_id`, `relation_type` (e.g., "warranty_for", "parent_of")
- **`ai_extractions`**: `id`, `capture_id`, `extracted_data` (JSONB), `provider_used`, `confidence_score`

## 4. API Boundaries

Strict REST API contracts separating UI from business logic.

- **Auth**: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`
- **Captures**:
  - `POST /api/v1/captures` (Submit new raw data)
  - `GET /api/v1/captures/:id/status` (Poll for processing status)
- **Dashboard**:
  - `GET /api/v1/home` (Aggregates "Needs Attention", "Upcoming", "Waiting For")
- **Items**:
  - `GET /api/v1/items`
  - `PATCH /api/v1/items/:id` (Update status/metadata)
  - `DELETE /api/v1/items/:id`

## 5. Authentication Strategy

- **Mechanism**: HTTP-only, secure, SameSite cookies carrying a JWT or opaque session token.
- **Data Isolation**: Every database query must strictly filter by `user_id` injected from the authenticated session middleware. No exceptions.
- **Security**: Passwords hashed with bcrypt/Argon2. Secrets managed exclusively via environment variables.

## 6. AI Provider Abstraction

The AI acts strictly as an intelligence layer. Business logic relies on structured outputs, not raw text.

```typescript
// /src/server/providers/ai/AIProvider.ts
export interface AIProvider {
  /** Classifies raw capture into an intent/domain */
  classifyIntent(input: string): Promise<IntentClassification>;
  
  /** Extracts structured entities (dates, amounts, people) */
  extractEntities(input: string, schema: ValidationSchema): Promise<StructuredData>;
}
```
*Current Implementation*: `GeminiProvider` using `@google/genai`. Responses are validated using strict Zod schemas before hitting the database.

## 7. Phase 0 and 1 Implementation Plan

### Phase 0 — Foundation
*Objective: A stable, secure, deployable empty shell.*
1. Setup Express backend and Vite Vite React frontend serving concurrently.
2. Configure PostgreSQL connection and define base schema (Users).
3. Implement secure authentication (Login/Register) with HTTP-only cookies.
4. Establish API routing and error handling middleware.
5. Create empty standard layouts (Navigation, Mobile-first shell).

### Phase 1 — Capture
*Objective: The user can input text, and the system securely stores it.*
1. Build the primary floating **+ Capture** UI.
2. Implement `POST /api/v1/captures` to store raw text input in the database.
3. Build a simple "Inbox/History" view to show raw captures (pre-AI processing).
4. *Note: AI entity extraction is intentionally deferred to Phase 2.*

## 8. Technical Risks

1. **AI Non-Determinism**: LLMs may format dates incorrectly or hallucinate entities. *Mitigation: Strict schema validation (e.g., Zod) on all AI outputs; fallback to manual human review if confidence is low.*
2. **Data Privacy**: Accidentally logging PII or sending sensitive data to unauthorized third parties. *Mitigation: Strict audit of logging mechanisms; zero logging of `raw_payload` or `extracted_data` in application logs.*
3. **Cross-User Leakage**: *Mitigation: Mandatory `user_id` scoping at the data-access layer; robust test coverage asserting unauthorized access fails.*

## 9. Decisions Postponed

1. **Native Mobile Frameworks**: We will use a responsive Web UI for the MVP to validate the architecture before committing to React Native or Flutter.
2. **End-to-End Encryption (E2E)**: Complex key management is deferred. MVP will rely on robust TLS in transit and standard Cloud provider at-rest encryption, with row-level security.
3. **Multi-Modal Capture**: Image, PDF, and Voice processing are deferred. We will start strictly with unstructured text.
## 10. Phase 6 - Connected Life Context

*Objective: Turn isolated items into connected, contextual graphs (e.g. A Car entity connected to its Insurance, Registration, and Repairs).*
1.  **Item Relations Schema:** Added `item_relations` table connecting `sourceItemId` and `targetItemId`.
2.  **AI Relation Suggestion:** The `AIProvider` automatically cross-references new captures against known entities (`vehicle`, `home`, `person`, `subscription`) and suggests connections.
3.  **Entity View:** A dedicated **Entities (Life Graph)** dashboard tab provides top-level access to context hubs.
4.  **Confirm Flow:** Users explicitly `Confirm` AI suggestions to prevent silent or hallucinated connections.
