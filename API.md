# API Documentation

## Base URL
All API requests should be prefixed with `/api/v1`

## Authentication

Authentication is handled via HTTP-Only, Secure, SameSite=None cookies. 
You must include credentials in your cross-origin requests.

### `POST /api/v1/auth/register`
Creates a new user account.
**Rate Limit**: 5 requests per 15 minutes per IP.
**Body**:
```json
{
  "email": "user@example.com",
  "password": "strongpassword123"
}
```

### `POST /api/v1/auth/login`
Authenticates a user and sets the session cookie.
**Rate Limit**: 5 requests per 15 minutes per IP.
**Body**:
```json
{
  "email": "user@example.com",
  "password": "strongpassword123"
}
```

### `POST /api/v1/auth/logout`
Clears the session cookie.

### `GET /api/v1/auth/me`
Retrieves the currently authenticated user's profile based on their session cookie.
**Headers**: Cookie with valid session token.
**Response**:
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

## Error Handling
The API uses standardized JSON error responses:
```json
{
  "error": "Human readable error message"
}
```
Standard HTTP status codes are used (400 for validation errors, 401 for unauthorized, 404 for not found, 429 for rate limit exceeded, 500 for server errors).
