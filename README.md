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
before running the suite. Local verification used Node 24.21.0 and PostgreSQL
16.15: both migrations applied to an empty database, 11 configuration tests and
all 30 existing regressions passed. See the PR's actual Actions result for CI
status; the workflow does not verify deployment or production behavior.

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

### Ticket Bookings

| Method   | Endpoint        | Auth     | Role               | Description                 |
| :------- | :-------------- | :------- | :----------------- | :-------------------------- |
| `POST`   | `/bookings`     | Required | `ATTENDEE`         | Book tickets for an event   |
| `GET`    | `/bookings/me`  | Required | `ATTENDEE`         | Retrieve my booking history |
| `DELETE` | `/bookings/:id` | Required | `ATTENDEE` (Owner) | Cancel a booking            |
