# Event Ticketing API

A RESTful API for an event ticketing system where organizers can create and manage events, and attendees can browse events and book tickets. Built with Node.js, Express, PostgreSQL, and Prisma ORM.

🔗 **Live API URL:** [https://ticketing-api-4wve.onrender.com](https://ticketing-api-4wve.onrender.com)

## 🚀 Tech Stack

- **Runtime:** Node.js 24 LTS (supported major line: `24.x`)
- **Framework:** Express 5
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Authentication & Security:** JWT (`jsonwebtoken`), bcryptjs, Helmet, CORS
- **Validation:** Zod

---

## 📁 Project Structure

```text
src/
├── controllers/      # Request handlers & request validation
├── lib/              # Shared library clients (Prisma client instance)
├── middlewares/      # JWT authentication, authorization & error handling
├── routes/           # API route definitions
├── services/         # Booking transactions, idempotency and concurrency strategies
├── utils/            # Shared utilities (AppError class)
├── app.js            # Express app configuration & middleware staging
└── server.js         # Entry point of the application
prisma/
├── schema.prisma     # Database schema design
└── seed.js           # Seed script for development data
```

---

## 🛠️ Local Setup

### 1. Prerequisites

- Node.js 24 LTS installed on your local machine (`nvm use` reads `.nvmrc`).
- PostgreSQL database running locally (or using a cloud provider like Neon).

_If you prefer running PostgreSQL via Docker, you can start a container using:_

```bash
docker run --name ticketing-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ticketing_dev -p 5432:5432 -d postgres:16
```

### 2. Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/ngovanduong-dev/ticketing-api.git
cd ticketing-api
npm ci
```

### 3. Environment Setup

Create a `.env` file in the root directory by copying the example file:

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ticketing_dev?schema=public"
JWT_SECRET="your-super-secure-jwt-secret-key"
JWT_EXPIRES_IN="7d"
PORT=3000
NODE_ENV="development"
```

### 4. Database Setup & Migrations

Generate the Prisma client, apply the committed migrations, and seed the initial development database:

```bash
npm run db:generate
npx prisma validate
npx prisma migrate deploy

# Seed database with initial categories, users, and events
npm run db:seed
```

### 5. Running the Application

To run the server in development mode with hot-reloading:

```bash
npm run dev
```

The API server will be available at `http://localhost:3000`. You can check the server health by sending a GET request to `/health`:

```bash
curl http://localhost:3000/health
```

The server loads `.env` and validates `DATABASE_URL`, `JWT_SECRET`, and the optional
TCP `PORT` (1–65535, default 3000) before importing the application and its database
resources. Direct imports of `src/app.js` require an already configured environment;
the app no longer loads `.env` as an import side effect.

## Regression tests with disposable PostgreSQL

Use a dedicated local PostgreSQL 16 container containing no data you need to keep:

```bash
docker run --name ticketing-test-db --rm -d -p 127.0.0.1:55432:5432 -e POSTGRES_USER=ticketing_test -e POSTGRES_PASSWORD=local-test-only -e POSTGRES_DB=ticketing_test postgres:16
docker exec ticketing-test-db pg_isready -U ticketing_test -d ticketing_test
```

Wait for `pg_isready` to report accepting connections before running migrations.
Copy `.env.test.example` to `.env.test`. Its credentials are for this disposable
container only. Keep `.env.test` uncommitted. It supplies `TEST_DATABASE_URL` and a
test-only `JWT_SECRET`; externally supplied variables take precedence.

In Bash, set test mode for the Prisma CLI and run:

```bash
export NODE_ENV=test
npm ci
npm run db:generate
npx prisma validate
npx prisma migrate deploy
npm test
```

In PowerShell, use `$env:NODE_ENV = 'test'` instead of `export NODE_ENV=test`, then
run the same npm/Prisma commands. Test-mode Prisma commands and the test bootstrap
load only `.env.test`, validate its required values, and then select
`TEST_DATABASE_URL` as the process's `DATABASE_URL`. No seed or migration reset is
needed. `npm run test:config` runs only the configuration/module-boundary checks,
without connecting to a database. `npm test` also runs all existing Vitest tests,
including the ten-request last-ticket booking concurrency regression.

The test URL must use `postgresql://` or `postgres://`, a numeric loopback host
(`127.0.0.1` or `[::1]`), explicit credentials and port, and a database named
`ticketing_test` or `ticketing_test_*` (suffix: lowercase letters, digits and
underscores). Query parameters and fragments are rejected, including `?schema=public`,
to prevent connection-option overrides. Missing or invalid explicit configuration
fails before helpers/application database resources are imported; ordinary
`DATABASE_URL` and `.env` are never fallback test targets.

This is an accidental-target guard, not proof that a database is disposable.
Never point the allowed loopback address at a tunnel/proxy to a shared or remote
database, or reuse a local database containing valuable data. The `vitest-*` data
prefix helps cleanup; it does not isolate database connections or transactions.
Always use a fresh dedicated instance, and do not run multiple suites against the
same database concurrently.

The GitHub Actions workflow runs on Ubuntu with Node 24 and a fresh PostgreSQL 16
service. It performs the five commands above, applying only committed migrations
before running the suite. See the actual Actions result for CI status; local
results do not establish CI success, deployment or production behavior.

When finished, remove the disposable instance and unset test mode before ordinary
development commands:

```bash
docker stop ticketing-test-db
unset NODE_ENV
```

In PowerShell, use `Remove-Item Env:NODE_ENV` instead of `unset NODE_ENV`.

---

## ⚙️ Available Scripts

- `npm run dev` - Starts the development server with `nodemon`.
- `npm start` - Starts the production server.
- `npm run db:migrate` - Creates/applies migrations during development (`prisma migrate dev`).
- `npm run db:generate` - Generates the Prisma client from the committed schema.
- `npm test` - Runs configuration checks and the PostgreSQL-backed regression suite.
- `npm run test:config` - Runs configuration checks without a database connection.
- `npm run db:seed` - Seeds the database with mock data.
- `npm run db:studio` - Opens Prisma Studio GUI to view/edit database records.

---

## 🔑 Seed Accounts (For Testing)

| Role          | Email                | Password      |
| :------------ | :------------------- | :------------ |
| **ORGANIZER** | `organizer@test.com` | `password123` |
| **ATTENDEE**  | `attendee@test.com`  | `password123` |

---

## 📡 API Endpoints

- **Production Base URL:** `https://ticketing-api-4wve.onrender.com/api/v1`
- **Local Base URL:** `http://localhost:3000/api/v1`

All API endpoints are prefixed with `/api/v1`.

### Authentication

| Method | Endpoint         | Auth   | Description                          |
| :----- | :--------------- | :----- | :----------------------------------- |
| `POST` | `/auth/register` | Public | Register a new user                  |
| `POST` | `/auth/login`    | Public | Authenticate a user and return a JWT |
| `GET`  | `/auth/me`       | User   | Get current logged-in user details   |

### Events Management

| Method   | Endpoint      | Auth     | Role                | Description                                               |
| :------- | :------------ | :------- | :------------------ | :-------------------------------------------------------- |
| `GET`    | `/events`     | Public   | All                 | List all published events (supports pagination & filters) |
| `GET`    | `/events/:id` | Public   | All                 | Get detailed information of a specific event              |
| `POST`   | `/events`     | Required | `ORGANIZER`         | Create a new event                                        |
| `PATCH`  | `/events/:id` | Required | `ORGANIZER` (Owner) | Update an event (only before event date)                  |
| `DELETE` | `/events/:id` | Required | `ORGANIZER` (Owner) | Cancel/Soft-delete an event                               |

An owner PATCH that supplies `capacity` must keep it at or above the **sum of
CONFIRMED booking quantities**, not the number of booking rows. A reduction from
10 to 2 with five confirmed tickets returns **409 Conflict**:

```json
{"status":"error","message":"Capacity cannot be less than confirmed ticket quantity"}
```

No fields in that PATCH are saved. Capacity equal to the confirmed quantity is
allowed, as are increases; capacity must still be a positive integer. Cancelled
bookings do not contribute to the total. Existing authorization and event checks
still apply.

Capacity PATCH and booking creation use the same PostgreSQL event-row
`SELECT ... FOR UPDATE` lock inside a Prisma interactive transaction at
`READ COMMITTED`. Both lock the event first, validate the locked row, read the
confirmed quantity, and write before releasing the lock at commit. A waiting
writer therefore makes its decision after the preceding writer commits. PATCH
without capacity keeps its existing path and response shape.

Same-event writes serialize. This protocol protects participating API writers;
it does not constrain arbitrary SQL clients or repair already-invalid data.
There is no cross-table database constraint. Transaction failures roll back;
the default booking path does not retry database errors automatically.

The concurrency regressions use separate PostgreSQL fixture/observer connections
and `pg_blocking_pids` to establish booking-first and reduction-first lock queues
before releasing either request. Bounded waits and request deadlines fail a broken
schedule; `finally` releases fixture locks and drains requests. The original
ten-request last-ticket regression remains in place.

### Ticket Bookings

| Method   | Endpoint        | Auth     | Role               | Description                 |
| :------- | :-------------- | :------- | :----------------- | :-------------------------- |
| `POST`   | `/bookings`     | Required | `ATTENDEE`         | Book tickets for an event   |
| `GET`    | `/bookings/me`  | Required | `ATTENDEE`         | Retrieve my booking history |
| `DELETE` | `/bookings/:id` | Required | `ATTENDEE` (Owner) | Cancel a booking            |

## Concurrency Architecture & Benchmark Metrics

Inventory remains `capacity - SUM(CONFIRMED booking.quantity)`. The migration adds
`Event.version` with a default of 1 and a PostgreSQL `IdempotencyRecord` table; it
does not introduce a second inventory counter. Existing event responses omit the
internal version field.

### Pessimistic Row Locking and Optimistic Concurrency Control

`POST /api/v1/bookings` continues to acquire `SELECT ... FOR UPDATE` on the event
before checking confirmed quantities. Creation, cancellation and capacity changes
use the same event-first lock protocol at `READ COMMITTED`. Booking cancellation
re-reads the booking after acquiring the lock. All booking mutations and event
updates increment the version in the same transaction as their effects.

`bookWithOptimisticLock` provides a service-level alternative. It reads the event
and confirmed quantity, then performs `UPDATE ... WHERE id = ? AND version = ?`.
A successful compare-and-swap (CAS) increments the version and inserts the booking
within one transaction. A stale version returns `VERSION_CONFLICT`; bounded retries
start a fresh transaction and repeat validation. The existing HTTP booking route
keeps its pessimistic strategy.

Row locking serializes contenders before the inventory decision. CAS permits
concurrent reads but can spend more queries on retries and still takes a row lock
for the update. `maxRetries` denotes the total attempt budget, including the first
attempt. One attempt does not guarantee selling every remaining ticket. The tests
check conservation and version increments for both one and five attempts; a
separate sequential phase checks remaining inventory after the one-attempt burst.
Direct SQL writers must follow the same version and locking protocol.

### Deadlock-Free Lexicographical Lock Ordering

`POST /api/v1/bookings/batch` accepts an authenticated `ATTENDEE` and a body such as:

```json
{"items":[{"eventId":"<event UUID>","quantity":1},{"eventId":"<another event UUID>","quantity":2}]}
```

The limit is 50 input items and 10 tickets per distinct event after duplicate IDs
are aggregated. PostgreSQL locks all matching events with
`ORDER BY "id" ASC FOR UPDATE`, using the database collation consistently instead
of a JavaScript locale-dependent sort. All events are checked before any booking
is inserted. A successful response is `201` with
`{"status":"success","data":{"bookings":[...]}}`; missing events return `404`,
unavailable/past events or invalid inputs return `400`, and insufficient capacity
returns `409`. A failure leaves every event in the bundle unchanged.

This ordering removes the opposite-order event-lock cycle among participating
bundle writers. It is not a guarantee against every possible PostgreSQL deadlock:
other transactions must obey the same ordering. The regression submits 20 bundles
in opposite input orders against two events with 10 tickets each and checks 10
successes, 10 inventory rejections, no database errors and zero remaining tickets.

### SHA-256 Payload-Hashed Idempotency

Both booking POST routes accept an optional `Idempotency-Key` containing 1–128
visible ASCII characters without spaces. Authentication, role checks, rate limits
and input validation still apply. The hash covers the entire JSON body, including
unknown fields: object keys are recursively sorted, nested values are retained,
and array order remains significant.

Keys are global and bound to the authenticated account and canonical route:

| Condition | Response |
| :--- | :--- |
| Completed key with the same body | Original status and JSON body, `Idempotency-Replayed: true` |
| Completed key with a different body | `422`, `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| Key bound to another account or route | `403`, `IDEMPOTENCY_KEY_OWNERSHIP_VIOLATION` |
| Key currently locked by another transaction | `409`, `IDEMPOTENCY_REQUEST_IN_FLIGHT` |

Each execution acquires a nonblocking transaction-scoped PostgreSQL advisory lock
derived from the key. The record, booking effects and serialized response commit
together. A lost HTTP response can therefore be retried without inserting another
booking. A failure before commit rolls everything back; failed handlers are not
cached. A retry during an active transaction returns `409` before inspecting any
uncommitted payload. Hash collisions in the advisory-lock namespace can cause a
conservative temporary `409`, but cannot mix stored responses.

The handler must perform all database writes through the supplied transaction;
external side effects are outside this guarantee. Transaction options allow 10
seconds to acquire a connection and 30 seconds for execution. The `lockedUntil`
timestamp is diagnostic, not permission to steal a live operation. Normal execution
never commits an `IN_PROGRESS` record; any such persisted record requires manual
investigation. Completed records currently have no automatic expiry. Deleting a
record permits the key to execute again, so retention needs an explicit operational
policy before introducing cleanup. Retrying without a key retains the original
booking behavior.

### Reproducing the Measurements

After configuring the dedicated test database and applying migrations as described
above, run:

```bash
npm test
npm run benchmark:concurrency
```

The benchmark requires the same guarded `TEST_DATABASE_URL` and test-only
`JWT_SECRET` as the regression suite. It creates and removes its own fixtures.
Run it alone against a disposable database. It prints JSON containing Node and
PostgreSQL versions, platform, workload sizes, outcome counts, elapsed wall time,
throughput and nearest-rank p50/p95/p99 latency in milliseconds.

The single-event workloads issue 25 simultaneous calls for five tickets using row
locks, one CAS attempt and five CAS attempts. The bundle workload issues 20 calls
with alternating event order against two events with 10 tickets each. Measurements
include the default 10-connection pool's queueing time, transaction work and rejected
calls; they exclude HTTP and authentication. Strategies run in that sequence without
a dedicated warm-up. Throughput counts all completed calls, not successful bookings.
Small local workloads are regression telemetry, not capacity estimates or a basis
for declaring one strategy faster. The suite verifies finite positive percentiles
and throughput, percentile ordering, rejected-task accounting and empty workloads.
