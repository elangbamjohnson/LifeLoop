# Database Schema Documentation

## Overview
The application uses PostgreSQL with Drizzle ORM. 

## Tables

### `users`
Stores application user accounts and authentication credentials.
- `id` (UUID, Primary Key) - Auto-generated unique identifier.
- `email` (VARCHAR, Unique, Not Null) - The user's email address.
- `password_hash` (VARCHAR, Not Null) - Bcrypt hashed password.
- `settings` (JSONB, Default: `{}`) - User-specific application preferences.
- `created_at` (TIMESTAMP, Not Null) - Timestamp of account creation.

## Proposed Domain Models (Pending Implementation)
The following domain boundaries are currently mapped in code (`/src/shared/types/domain.ts`) and will be implemented as tables in future phases:

- `captures` - Raw, unparsed data inputs.
- `items` - Parsed, structured entities.
- `sources` - Where the data originated (web, ios, email, etc).
- `reminders` - Time-based triggers linked to items.
- `documents` - File attachments and extracted text summaries.
- `waiting_fors` - Pending blockers linked to items and people.
- `persons` - Known contacts.

All user-owned resources will enforce strict Row-Level Security / Application-Level AuthZ by including a `user_id` foreign key referencing the `users` table.
