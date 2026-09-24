# Email Verification in LifeLoop (Phase 7.5A)

This document covers the end-to-end implementation details of the Email Verification system, introduced in Phase 7.5A.

## 1. Registration Flow & Account States

When a user registers via `/api/v1/auth/register`:
- A new user record is created in the `users` table with `accountStatus` set to `'pending_verification'`.
- An email verification token is generated, hashed, and stored in the `email_verification_tokens` table.
- An email is sent to the user containing a link to `/verify-email?token=<TOKEN>`.
- The frontend (if triggered via UI) detects the 201 response and transitions the user to the `EmailVerificationPending` state, displaying a masked version of their email.
- **Access Restrictions:** Users with a `pending_verification` status cannot access protected API endpoints. Attempts to access these return a `403 Forbidden` with the message "Please verify your email address to access this resource". Calling `/api/v1/auth/login` returns a `401 Unauthorized`. Calling `/api/v1/auth/me` returns a limited subset of user data (`id`, `email`, `accountStatus`) and restricts access to the dashboard.

## 2. Token Lifetime & Configuration

- **Generation:** Tokens are 32-byte cryptographically secure random bytes, encoded as hex strings.
- **Storage:** Only the SHA-256 hash of the token is stored in the database to prevent token leakage.
- **Lifetime:** Tokens are valid for 24 hours. The expiration time is calculated dynamically during generation and stored in the `expires_at` column.
- **Consumption:** When a token is successfully verified, its `used_at` timestamp is populated.

## 3. GET-Consumption Protection Model

We employ an **idempotent GET model with a grace window**.
- Verification is performed via a `GET /api/v1/auth/verify-email?token=<TOKEN>` request.
- This request is naturally triggered when a user visits the `/verify-email` frontend route, which fires the API call.
- **Protection:** If an enterprise email scanner, preview unfurler, or prefetcher accesses the link first, it consumes the token. However, if the legitimate user clicks the identical link within **5 minutes** of its first use (the grace window), the API will idempotently return `success: true`. This prevents the "already used" error that plagues strict single-use GET tokens without requiring a friction-heavy interstitial "Click here to verify" button.
- **Atomicity:** Concurrency is handled by an atomic `UPDATE ... WHERE used_at IS NULL`. If a concurrent request loses the race but happens within the 5-minute window, it receives a success response.

## 4. Resend Behavior & Rate Limits

Users in the `pending_verification` state can request a new verification email.
- Endpoint: `POST /api/v1/auth/resend-verification`
- Behavior: The system marks any existing unused tokens for that user as expired (setting `expires_at = NOW()`), generates a new token, and sends a fresh email.
- **Rate Limit:** This endpoint is protected by a strict rate limit (via `express-rate-limit`) of **5 requests per 15 minutes** per IP address. Exceeding this returns a `429 Too Many Requests`. The UI also implements a client-side 60-second cooldown on the resend button to prevent accidental double-clicks.

## 5. Change Email Behavior

If a user realizes they made a typo in their email address during registration, they can change it from the pending screen.
- Endpoint: `POST /api/v1/auth/change-email`
- Behavior: Accepts the `currentEmail` and `newEmail`. If the `newEmail` is not already in use by another account, the user's email is updated. Any old verification tokens are expired, and a new token is sent to the new address.
- UI: The user remains in the pending state but the masked email updates to reflect the new address.

## 6. API Endpoint List

- `POST /api/v1/auth/register` — Creates account, sends initial email.
- `GET /api/v1/auth/verify-email` — Verifies token, activates account.
- `POST /api/v1/auth/resend-verification` — Sends a new token, expires old ones (Rate limited).
- `POST /api/v1/auth/change-email` — Updates unverified email address and sends a new token.
- `GET /api/v1/auth/me` — Returns full profile for verified users, or restricted profile for pending users.

## 7. Email Provider Configuration

The application uses an abstraction layer for email delivery (`EmailProvider`).
- Configuration is driven by the `EMAIL_PROVIDER` environment variable.
- Production/Development: Use `EMAIL_PROVIDER=resend` (requires `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS`).
- End-to-End Testing: Use `EMAIL_PROVIDER=mock`.

### MockEmailProvider (Dev/Test)

When `EMAIL_PROVIDER=mock`, emails are not sent over the network. Instead, they are captured in memory.
- In E2E tests, Playwright accesses the captured emails via a dedicated `GET /api/v1/test/mock-emails` endpoint (only exposed when `EMAIL_PROVIDER=mock`). This allows tests to extract the real generated tokens and navigate to the verification URLs, simulating a complete user flow without requiring an external mailbox service.

## 8. Existing User Migration

In Phase 7.5A-1, a database migration (`0006_email_verification.sql`) was introduced.
- This migration adds the `account_status` column to the `users` table, defaulting to `'active'` for existing rows.
- This guarantees that existing users prior to this phase are automatically grandfathered in and will not be locked out of their accounts. New users created after this migration will default to `'pending_verification'`.
