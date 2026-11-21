# MediBook: Clinic Appointment System

MediBook is a backend for a community clinic. Patients book 30-minute slots with doctors between 09:00 and 17:00. Each doctor sees at most 12 patients a day, and the administrator gets revenue and utilization reports. When a slot is full, patients can join a Redis waitlist. A separate worker process books them in automatically when someone cancels.

**Stack:** Node.js · Express 5 · MySQL 8 (`mysql2`, parameterized queries, no ORM) · Redis (`ioredis`) · Jest
---

## Contents
- [Project structure](#project-structure)
- [Setup](#setup)
- [Running](#running)
- [API overview](#api-overview)
- [Design justifications](#design-justifications)
- [Tests (Part F)](#tests-part-f)
- [Feedback page, i18n (Part G)](#feedback-page-i18n-part-g)
- [Further documentation](#further-documentation)

---

## Project structure

```
├── database/
│   ├── schema.sql            # Database schema
│   ├── seed.sql              # Sample data
│   └── NORMALIZATION.md      # Spreadsheet → 3NF walkthrough
├── schema-diagram.png        # Database schema diagram
├── docs/                     # API reference and database doc
├── locales/                  # en.json, fr.json
├── src/
│   ├── models/               # Application SQL
│   ├── controllers/          # Request handling and business logic
│   ├── routes/               # URL + HTTP method → controller
│   ├── services/             # Booking/cancellation rules shared by the API and the worker
│   ├── queue/                # Redis waitlist + job queues
│   ├── middleware/           # Central error handler
│   ├── utils/                # Pure functions (refund, slot check), audit logger, i18n
│   ├── validators/           # Request validation (400 messages)
│   ├── views/                # HTML for the feedback page
│   ├── app.js                # Express app
│   ├── server.js             # Web server entry point
│   └── worker.js             # Queue worker entry point
└── tests/                    # Jest unit tests
```

---

## Setup

### Prerequisites
| Tool | Version | Why |
|---|---|---|
| Node.js | 18+ | Built-in `fetch`, `crypto.randomUUID` |
| MySQL | **8.0.16+** | Older versions don't enforce `CHECK` constraints |
| Redis | **6.2+** | Needs the `LMOVE` / `BLMOVE` commands used by the reliable queue |

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```
Then edit `.env` and set `DB_PASSWORD` (and anything else that differs on your machine). `.env` is git-ignored, so never commit it.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | MySQL server |
| `DB_USER` / `DB_PASSWORD` | `root` / — | MySQL credentials |
| `DB_NAME` | `medibook` | Database created by `schema.sql` |
| `AUDIT_LOG_DIR` | `logs` | Audit log folder, relative to the project root (created automatically) |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis server |

### 3. Create and seed the database
```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```
In **PowerShell**, where `<` doesn't work, use `source` instead:
```powershell
mysql -u root -p -e "source database/schema.sql"
mysql -u root -p -e "source database/seed.sql"
```
If `mysql` isn't on your PATH, use the full path, e.g. `"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"`.

`schema.sql` **drops and recreates** the `medibook` database, so re-running both scripts always gives you a clean demo state. Seed dates are relative to the day you load it (`CURDATE() ± n`). That keeps "upcoming", "next 7 days" and the full day (Dr. Boateng, 12/12, three days from now) meaningful whenever you run it.

### 4. Start Redis

```bash
sudo apt install -y redis-server
sudo service redis-server start
redis-cli ping              # → PONG
```

---

## Running

The web server and the worker are **separate processes**. Use two terminals:

```bash
npm start           # API + feedback page on http://localhost:3000
npm run worker      # queue worker: waitlist promotions + confirmation notifications
```

| Command | What it does |
|---|---|
| `npm start` | Starts the web server. Checks MySQL first and exits with a clear message if it can't connect |
| `npm run dev` | Same, restarting on file changes |
| `npm run worker` | Starts the worker. It first recovers any jobs or waitlist entries left by a crash |
| `npm test` | Runs the 10 unit tests. They need no MySQL and no Redis |

Quick check once both are running:
```
GET http://localhost:3000/health                    → {"status":"ok"}
GET http://localhost:3000/api/reports/doctors       → every doctor, including Dr. Darko with 0
GET http://localhost:3000/feedback?lang=fr          → French feedback form
```

Redis is only needed for the waitlist and notifications. If Redis is down, bookings and cancellations still work (only their queued jobs are skipped), and `POST /api/waitlist` answers `503`.

---

## API overview

Base URL `http://localhost:3000/api`. JSON in and out. Date-times are clinic-local: `"2026-12-01 09:30"`.

| Method | Path | Description |
|---|---|---|
| GET · POST | `/patients` | List / create patients |
| GET · PUT · PATCH · DELETE | `/patients/:id` | Read / replace / partially update / delete |
| GET | `/patients/:id/appointments` | A patient's bookings and cancellations |
| GET · POST | `/doctors` | List / create doctors |
| GET · PUT · PATCH · DELETE | `/doctors/:id` | Read / replace / partially update / delete |
| GET | `/doctors/:id/stats` | Revenue, upcoming count, next 7 days per day, utilization % |
| POST | `/appointments` | **Book** → `201` |
| GET | `/appointments/:id` | One appointment |
| DELETE | `/appointments/:id` | **Cancel** → `200` with the server-computed refund |
| GET | `/reports/doctors` | All doctors' appointments and revenue, including doctors with 0 |
| GET | `/reports/busy-days?from=&to=` | (doctor, date) pairs with more than 80% of 12 slots booked |
| POST | `/waitlist` | Join the waitlist for a full slot or day → `201` with your position |
| GET | `/waitlist?doctor_id=&date=` | View a waitlist in order |

Example booking:
```http
POST /api/appointments
Content-Type: application/json

{ "patient_id": 2, "doctor_id": 2, "appt_datetime": "2026-12-01 10:30" }
```

All errors share one shape: `{ "error": { "status", "code", "message", "details?" } }`. Full reference with every status code: **[docs/API.md](docs/API.md)**.

---

## Design justifications

### API design and business rules

**REST design.** URLs are plural nouns, and the HTTP method says what happens. Stats are a read-only view of one doctor (`/doctors/:id/stats`). Reports cover the whole clinic, so they get their own `/reports` group. `PUT` replaces a whole record and `PATCH` updates only the fields sent. Unknown fields are rejected with a 400, so a typo isn't silently ignored.

**Cancellation is `DELETE /appointments/:id`.** To the client the booking is gone. On the server it's a *soft delete*: the row stays with `status='cancelled'`, `cancelled_at` and `refund_amount`, because that is the refund history. It returns `200` with a body, not `204`, because the client needs the refund amount. A second cancel returns `409`, so no one gets a second refund.

**Status codes.**
- `400`: the input is malformed (wrong type, missing field, bad JSON).
- `404`: no such resource.
- `409`: conflicts with the *current state*, so it could succeed later. Examples: slot taken, day full, duplicate email, deleting a record with history.
- `422`: well-formed but breaks a *rule*, so it will never succeed as sent. Examples: 09:15, 17:00, a past date.

**Booking rules: how each is guaranteed.**
1. *Future, 09:00–17:00, 30-minute boundary:* checked by the pure function `validateSlot()` and enforced again by `CHECK` constraints. The last slot **starts at 16:30**. 17:00 is rejected because the appointment would end after closing. "In the future" is checked in the app, because a `CHECK` can't use `NOW()`.
2. *At most 12 per doctor per day:* the booking runs in a transaction that **locks the doctor's row** (`SELECT … FOR UPDATE`) before counting. Concurrent bookings for the same doctor wait in line, so two requests can't both see "11 booked". Other doctors aren't blocked.
3. *Two patients can never hold the same slot, even at the same instant:* the same lock, plus the database's **`UNIQUE (doctor_id, appt_datetime, active_slot)`** index as the final guarantee. `active_slot` is a generated column: `1` while booked, `NULL` once cancelled. MySQL never treats two NULLs as duplicates, so cancelled rows stay for history while the slot can be booked again. Tested with 5 simultaneous requests for one slot: exactly 1 got `201` and 4 got `409`.

**Cancellation rules.**
- The refund is computed by the server, never sent by the client. Policy, by notice given:
  - **more than 48 h → 100%**
  - **24 h to 48 h, inclusive → 50%** (exactly 48 h and exactly 24 h both give 50%)
  - **less than 24 h → 0%**

  Money is rounded in integer cents.
- Cancellation and refund record succeed or fail together: one `UPDATE` sets `status`, `cancelled_at` and `refund_amount` inside a transaction that locks the row. A `CHECK` constraint makes a half-written record impossible.
- The cancellation then queues a waitlist promotion (Part E).

**Layers.** Routes → controllers (HTTP: validation, status codes, audit log) → service (`appointmentService`: booking and cancellation rules, no SQL, reused by the worker) → models (**all SQL**, every value bound with `?`). The only dynamic SQL is the `SET` clause of updates, and its column names come from a fixed whitelist, never from the client. **Reports and stats are computed in SQL**:
- `LEFT JOIN` + `COUNT`/`SUM` + `COALESCE`, so doctors with no appointments still appear.
- `GROUP BY … HAVING COUNT(*) > 12 × 0.8` for busy days.
- A recursive CTE generates the next 7 dates, so days with no bookings show 0.

### Audit Log (`fs` module)

[src/utils/auditLogger.js](src/utils/auditLogger.js) appends one JSON line per event to `logs/audit.log`: bookings, cancellations, waitlist events and notifications.
- **Non-blocking:** it uses `fs/promises` (`mkdir`, `appendFile`). There are no `*Sync` calls anywhere in request handling.
- **Creates `logs/` on first run:** `mkdir({ recursive: true })`, run once and remembered. If it fails, it's retried on the next write.
- **A logging failure never fails the request:** `audit()` catches every error, reports it to stderr, and resolves `false`. It never rejects. Controllers call it *after* the database commit and don't wait for it, so a broken or slow disk can't break or delay a booking. Tested by putting a file where the log folder should be: the write failed, and the call still returned normally.
- **Only successful operations are logged:** the call comes after commit, so a rolled-back booking never appears.
- **Web server and worker share one file safely:** each line is written by a single append-mode `appendFile`, so lines from the two processes never mix.

### Redis and Queues

**Plain Redis lists with the reliable-queue pattern** (no Bull). Every step is visible and easy to explain:
- `BLMOVE` takes a job and moves it into `queue:processing` in **one atomic step**, so a job never exists only in the worker's memory.
- On success, the job is removed from `processing`.
- On failure, it's retried with `attempts + 1`, or after 3 attempts moved to the dead-letter list `queue:failed`.
- When the worker starts, it moves any jobs left in `processing` back onto the queue.

**Waitlist.** One FIFO list per (doctor, date). You can only join when the requested slot or the whole day is full; if the slot is free, you get `409 SLOT_AVAILABLE` and should book it directly.
- If the **day** was full, the patient takes **any** slot that frees up that day.
- If only **that slot** was taken, they wait for **that exact** slot.

Joining twice is blocked, and so is joining when the patient already has a booking that day.

**What if the promoted booking fails? The patient never vanishes.** Every move between lists is a Lua script, so Redis runs it atomically:
```
waitlist ──claim──▶ pending ──finish──▶ removed   (booked, or patient no longer exists)
    ▲                  │
    └────requeue───────┘                          (booking failed → back to the FRONT)
```
1. The worker moves the first eligible patient from the waitlist into `pending` in one step.
2. It books them through the **same `bookAppointment()`** as the API, so the lock, the cap and the unique index all still apply.
3. The outcome is decided by `classifyPromotionFailure()`, a pure function covered by a unit test:
   - **Booked:** the entry is removed, the booking is audited with `source:"waitlist"`, and a confirmation job is queued.
   - **Slot taken or day full again (409), or slot now in the past (422):** the patient goes back to the **front** and keeps their place.
   - **Database down or unexpected error:** the patient goes back to the front, and the job is retried.
   - **Patient deleted:** the entry is removed, the removal is audited, and the next patient in line gets the slot.
4. **If the worker crashes** while a patient is in `pending`, they go back to the front of the waitlist on restart. Before booking, the worker checks whether the patient already has a booking that day, so a retry can't double-book. Tested: after a simulated crash, the patient was restored to the front and the half-done job ran exactly once.

**Notifications.** Every confirmed appointment, from the API or a waitlist promotion, queues an `APPOINTMENT_CONFIRMATION` job. The worker "sends" it by writing a `NOTIFICATION_SENT` line, with the message text, to the audit log. If that write fails, the job fails and is retried.

---

## Tests

```bash
npm test
```
10 Jest unit tests on pure functions. **No MySQL or Redis needed.**

| File | Covers |
|---|---|
| [tests/refund.test.js](tests/refund.test.js) | All three refund tiers, plus both boundaries: **exactly 48 h → 50%** (48 h + 1 ms → 100%) and **exactly 24 h → 50%** (24 h − 1 ms → 0%). Also cent rounding |
| [tests/slot.test.js](tests/slot.test.js) | 09:00 and 16:30 accepted. Edge cases **17:00** and 08:30 (outside hours); **09:15** and 09:30:10 (off the 30-minute grid); **malformed** dates (Feb 30, `Z` suffix, wrong format, non-strings); past times and exactly now |
| [tests/promotionPolicy.test.js](tests/promotionPolicy.test.js) | Which waitlisted patients can take a freed slot, and how each kind of promotion failure is handled |

To check that the boundary tests really pin down the policy, each refund boundary was broken on purpose (`>` swapped for `>=`). The matching test failed each time.

---

## Feedback page, i18n

`GET /feedback` serves a course-feedback form with **exactly 5 essay questions**, each answered in a `<textarea>`.

- **All text comes from locale files:** [locales/en.json](locales/en.json) and [locales/fr.json](locales/fr.json) hold the page title, heading, instructions, the 5 questions, the button and the messages.
- **Language selection:** `/feedback?lang=fr` shows French. The default is English. Any unsupported or malformed value (`?lang=de`, `?lang=`, `?lang=../../etc`, a repeated `lang`) **falls back to English** instead of crashing. Region tags are reduced to the language (`fr-CA` → `fr`).
- **Localized date:** today's date is formatted with `Intl.DateTimeFormat` for the active locale, giving "Saturday, 21 November 2026" or "samedi 21 novembre 2026". Punctuation is localized too: French labels have a space before the colon ("Date du jour :").
- **Loaded and validated once at startup:** a locale file with a missing key, or without exactly 5 questions, stops the server with a clear error, so a half-translated page can never be served.
- **Safe output:** every value is HTML-escaped, including user input. Submitting writes the answers to the audit log (no extra table is allowed). An empty answer re-shows the form with a localized error (`400`) and keeps what was already typed.

Adding a language takes one new file, e.g. `locales/es.json`, with the same keys. It appears in the language switcher automatically.

---

## Further documentation

| Document | Contents |
|---|---|
| [docs/API.md](docs/API.md) | Full endpoint reference and status codes |
| [docs/database.md](docs/database.md) | Mermaid ER diagram and the business rules enforced by the database |
| [database/NORMALIZATION.md](database/NORMALIZATION.md) | From the clinic spreadsheet to 3NF |
| [schema-diagram.png](schema-diagram.png) | Schema diagram |
