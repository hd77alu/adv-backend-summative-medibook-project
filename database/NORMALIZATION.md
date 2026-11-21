# Normalization: from spreadsheet to 3NF

The clinic's spreadsheet has one row per appointment:

`appt_ref, patient_name, patient_email, patient_phone, doctor_name, specialty, consultation_fee, room, appt_datetime, amount_paid, booked_on`

## Problems in the original sheet

| Anomaly | Example |
|---|---|
| **Update** | Ama Mensah's phone number is stored on AP-001 and on AP-003. If she changes it, every row has to be edited, or the copies stop matching. |
| **Insert** | A new doctor can't be recorded until somebody books with them. Dr. Darko in the seed data is an example. |
| **Delete** | Deleting Dr. Adjei's only appointment would also delete everything we know about Dr. Adjei. |

## 1NF
Every cell already holds a single value and every row is identified by `appt_ref`. So the sheet is in 1NF, but all the data sits in one wide table.

## 2NF
The key is a single column (`appt_ref`), so partial dependencies can't happen. The sheet is technically in 2NF.

## 3NF: remove transitive dependencies
- `appt_ref → patient_email → patient_name, patient_phone`. These columns are facts about the **patient**, so they move to `patients`.
- `appt_ref → doctor_name → specialty, consultation_fee, room`. These are facts about the **doctor**, so they move to `doctors`.
- What's left (`appt_datetime`, `amount_paid`, `booked_on`) depends only on the appointment. This becomes `appointments`, with `patient_id` and `doctor_id` foreign keys in place of the copied names.

### Why `amount_paid` stays on `appointments`
`amount_paid` isn't a copy of `consultation_fee`. On AP-002 the patient paid 120.00 while the fee was 150.00. It records what happened on that booking, and it must not change if the doctor's fee goes up later. That means it depends on the appointment alone, so keeping it there doesn't break 3NF.

### Other choices
- **Surrogate keys** (`INT UNSIGNED AUTO_INCREMENT`) replace names. Two patients can have the same name, and emails can change. `email` is still `UNIQUE` as a natural candidate key.
- `appt_ref` (`AP-001`) can be derived from `appointments.id`, so it isn't stored. Storing it would be redundant.
- `booked_on` becomes `booked_at DATETIME`, so the exact booking time is kept.
- **Cancellation and refund data** (`status`, `cancelled_at`, `refund_amount`) goes on `appointments`. The assignment allows only 3 tables, and each cancellation belongs to exactly one appointment (1:1), so these columns depend on the appointment key. A CHECK constraint makes sure the cancellation fields are either all set or all empty.
- `appt_date` and `active_slot` are **stored generated columns**. MySQL computes them, so they can never disagree with their source columns. They exist only to support indexes and constraints. See the diagram and `schema.sql` for the double-booking rule.

## Result
```
patients (1) ──< appointments >── (1) doctors
```
- One patient can have many appointments.
- One doctor can have many appointments.
- Each appointment belongs to exactly one patient and exactly one doctor.
