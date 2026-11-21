# MediBook API: endpoints and design justifications

Base URL: `http://localhost:3000/api`. Requests and responses are JSON.

## Conventions

- Success responses look like `{ "data": ... }`. Lists also include `"count"`.
- Errors look like `{ "error": { "status", "code", "message", "details?" } }`. One central error middleware builds every error response: [src/middleware/errorHandler.js](../src/middleware/errorHandler.js).
- Date-times are clinic-local wall-clock times in the format `"YYYY-MM-DD HH:mm"` (a `T` separator also works, e.g. `2026-12-01T09:30`). The API rejects timezone suffixes such as `Z`, because "09:00" must always mean 09:00 at the clinic.

### Status codes

| Code | Meaning in this API | Example |
|---|---|---|
| `200` | OK | read, update, cancel |
| `201` | Created. Includes a `Location` header | new patient, doctor or booking |
| `204` | Deleted, no body | delete a patient with no history |
| `400` | The request is malformed. The input is the wrong shape or type, so it can't be processed at all | missing field, bad email, `id=abc`, invalid JSON, `appt_datetime="tomorrow"` |
| `404` | The resource doesn't exist | `GET /api/doctors/999` |
| `409` | The request conflicts with the **current state** of the data. The same request could succeed at another time | slot already taken, doctor's day full, duplicate email, already cancelled, delete with history |
| `422` | The input is well-formed but breaks a **business rule**. It will never succeed as sent | 09:15 (not on a slot), 17:00 (outside hours), a time in the past, cancelling a past appointment |
| `503` | The database is unreachable | |

## Endpoints

### Patients: [patientRoutes.js](../src/routes/patientRoutes.js)
| Method | Path | Description |
|---|---|---|
| GET | `/patients` | List all patients |
| GET | `/patients/:id` | Get one patient |
| POST | `/patients` | Create. Body: `{ full_name, email, phone }` → `201` |
| PUT | `/patients/:id` | Replace the record. All fields are required |
| PATCH | `/patients/:id` | Partial update. At least one field is required |
| DELETE | `/patients/:id` | `204`. Returns `409` if the patient has appointment history |
| GET | `/patients/:id/appointments` | The patient's bookings and cancellations |

### Doctors: [doctorRoutes.js](../src/routes/doctorRoutes.js)
| Method | Path | Description |
|---|---|---|
| GET | `/doctors` | List all doctors |
| GET | `/doctors/:id` | Get one doctor |
| POST | `/doctors` | Body: `{ full_name, email, specialty, consultation_fee, room }` → `201` |
| PUT / PATCH | `/doctors/:id` | Full or partial update |
| DELETE | `/doctors/:id` | `204`. Returns `409` if the doctor has appointment history |
| GET | `/doctors/:id/stats` | Revenue collected, upcoming appointments, appointments per day for the next 7 days, utilization % |

### Appointments: [appointmentRoutes.js](../src/routes/appointmentRoutes.js)
| Method | Path | Description |
|---|---|---|
| POST | `/appointments` | Book. Body: `{ patient_id, doctor_id, appt_datetime }` → `201` |
| GET | `/appointments/:id` | Get one appointment, with patient and doctor details |
| DELETE | `/appointments/:id` | Cancel → `200` with the refund the server computed |

### Reports: [reportRoutes.js](../src/routes/reportRoutes.js)
| Method | Path | Description |
|---|---|---|
| GET | `/reports/doctors` | Every doctor's total appointments and revenue, including doctors with 0 |
| GET | `/reports/busy-days?from=&to=` | Every (doctor, date) with more than 80% of the 12 daily slots booked. `from` and `to` are optional (`YYYY-MM-DD`) |

## Design justifications (Part C)

**URL design.** URLs name resources with plural nouns, and the HTTP method says what to do with them. Statistics are a read-only view of one doctor, so they sit under that doctor (`/doctors/:id/stats`). The reports cover the whole clinic, not one resource, so they have their own `/reports` group. A patient's appointments are nested under the patient (`/patients/:id/appointments`) because they are read through that relationship.

**Cancellation is `DELETE /appointments/:id`.** From the client's point of view, cancelling removes the booking, and the brief says appointments "get their delete behaviour" from cancellation. On the server it is a *soft delete*: the row is kept with `status = 'cancelled'`, `cancelled_at` and `refund_amount`, because that is the refund history. The response is `200` with a body, not `204`, because the client needs the refund amount. Cancelling the same appointment again returns `409 ALREADY_CANCELLED` rather than a second refund.

**PUT vs PATCH.** `PUT` replaces the whole resource, so every field is required. `PATCH` changes only the fields sent. Both reject unknown fields, so a typo like `fullname` gives a clear 400 instead of being silently ignored.

**Layers.** Routes only map URLs to controllers. Controllers deal with HTTP: they validate input, choose the status code and write the audit log. [appointmentService.js](../src/services/appointmentService.js) holds the booking and cancellation rules and contains no SQL. It is kept separate from the controller so the Part E worker can reuse exactly the same rules. **All SQL is in `src/models/`.** Every value is bound with a `?` placeholder. The dynamic `UPDATE` builds its `SET` clause only from a fixed whitelist of column names, never from what the client sends.

**Booking rules: how each one is guaranteed.**
1. *Future, 09:00–17:00, on a 30-minute boundary:* `validateSlot()` ([utils/slot.js](../src/utils/slot.js)) is a pure function. The clinic closes at 17:00, so the last slot starts at **16:30**. A 17:00 booking is rejected because it would end at 17:30. The `CHECK` constraints in MySQL enforce the same rule again. The "future" check has to live in the app, because a `CHECK` constraint can't call `NOW()`.
2. *At most 12 per doctor per day:* the booking runs in a transaction. It first locks the doctor's row (`SELECT … FOR UPDATE`), then counts that day's bookings. Any other booking for the same doctor waits for that lock, so two requests can't both see "11 booked" and both insert. Bookings for different doctors don't block each other.
3. *Two patients can never hold the same slot, even at the same instant:* the same lock plus an explicit check gives a clear `409 SLOT_TAKEN`. The database also guarantees it: the unique index `(doctor_id, appt_datetime, active_slot)` makes MySQL reject any duplicate insert that got past the check (`ER_DUP_ENTRY` → `409`). Five simultaneous requests for one slot result in exactly one `201` and four `409`s.

`amount_paid` is copied from the doctor's fee **at booking time**, so changing the fee later doesn't change what past patients paid.

**Cancellation rules.**
- *The server computes the refund.* The client never sends an amount. [utils/refund.js](../src/utils/refund.js) uses the notice given (appointment start minus cancellation time):
  - **more than 48 h → 100%**
  - **from 24 h to 48 h, inclusive → 50%** (exactly 48 h gives 50%, exactly 24 h gives 50%)
  - **less than 24 h → 0%**

  The calculation compares whole milliseconds and rounds money in integer cents. A past or ongoing appointment can't be cancelled (`422`).
- *Cancellation and refund record succeed or fail together.* A single `UPDATE` sets `status`, `cancelled_at` and `refund_amount` inside a transaction that locks the row. The `chk_appt_cancel_record` CHECK constraint makes a half-written cancellation impossible even at the database level.
- *The cancelled slot becomes bookable again:* `active_slot` becomes `NULL`. The unique index ignores NULLs, so a new booking of that slot is accepted while the cancelled row stays for history.

**Reports and stats are produced in SQL** ([reportModel.js](../src/models/reportModel.js), [doctorModel.js](../src/models/doctorModel.js)):
- *Doctors report:* `LEFT JOIN` + `COUNT`/`SUM` + `COALESCE`, so doctors with no appointments still appear with 0 and 0.00.
- *Busy days:* `GROUP BY doctor, date` with `HAVING COUNT(*) > 12 × 0.8`. That means 10 or more bookings.
- *Next 7 days in stats:* a recursive CTE generates the 7 dates and `LEFT JOIN`s the bookings onto them, so days with no bookings show 0 instead of being missing.
- *Revenue collected* = `amount_paid − refund_amount`, i.e. the money the clinic keeps.

## Design justifications (Part D): audit log

[utils/auditLogger.js](../src/utils/auditLogger.js) appends one JSON line per successful booking or cancellation to `logs/audit.log`:

```json
{"timestamp":"2026-11-21T13:40:47.912Z","event":"APPOINTMENT_CANCELLED","appointment_id":7,"refund_amount":75,"refund_percentage":50,...}
```

- **Async and non-blocking.** It uses `fs/promises` (`mkdir`, `appendFile`) and no `*Sync` calls, so the event loop keeps serving other requests while the write happens.
- **Creates `logs/` on first run.** It calls `mkdir({ recursive: true })` once and remembers the result. If that fails, it tries again on the next write.
- **A logging failure doesn't fail the request.** `audit()` catches every error, reports it to stderr, and resolves `false`. It never rejects. Controllers call it *after* the database commit and don't await it, so a slow or broken disk can't delay or break a booking.
- **Concurrent writers.** Each entry is written with a single `appendFile` in append mode, so lines from the web server and (in Part E) the worker don't get mixed together.
- **Only successful operations are logged.** The call comes after the transaction commits, so a rolled-back booking never appears in the log.
