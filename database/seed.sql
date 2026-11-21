-- =============================================================================
-- MediBook — sample data
-- database/seed.sql   (run AFTER schema.sql:  mysql -u root -p < database/seed.sql)
--
-- Dates are RELATIVE to the day the seed is loaded (CURDATE() ± n days), so
-- "upcoming", "next 7 days" and the busy-day/cap scenarios always make sense
-- no matter when the project is run.
--
-- What this data demonstrates:
--   * 6 patients, 4 doctors — Dr. Akosua Darko (id 4) has NO appointments
--     (must still appear in the doctors report with 0 / 0.00).
--   * Dr. Kwame Boateng (id 1) is fully booked (12/12) on day +3 → busy-days
--     report, and any further booking that day must be refused / waitlisted.
--   * Past appointments → revenue collected.
--   * Two cancellations with refund records (50% and 100% tiers), one of
--     which sits on a slot that has since been re-booked by another patient —
--     proving a cancelled slot is bookable again while its history is kept.
-- =============================================================================

USE medibook;

-- -----------------------------------------------------------------------------
-- Patients
-- -----------------------------------------------------------------------------
INSERT INTO patients (id, full_name, email, phone) VALUES
  (1, 'Ama Mensah',    'ama@mail.com',    '0244-111-222'),
  (2, 'Kojo Owusu',    'kojo@mail.com',   '0555-333-444'),
  (3, 'Abena Asare',   'abena@mail.com',  '0201-555-666'),
  (4, 'Kwesi Appiah',  'kwesi@mail.com',  '0277-777-888'),
  (5, 'Esi Quaye',     'esi@mail.com',    '0549-999-000'),
  (6, 'Yaa Ofori',     'yaa@mail.com',    '0262-123-456');

-- -----------------------------------------------------------------------------
-- Doctors
-- -----------------------------------------------------------------------------
INSERT INTO doctors (id, full_name, email, specialty, consultation_fee, room) VALUES
  (1, 'Dr. Kwame Boateng', 'k.boateng@medibook.clinic', 'Dermatology',      150.00, 'R-12'),
  (2, 'Dr. Efua Adjei',    'e.adjei@medibook.clinic',   'Paediatrics',      100.00, 'R-03'),
  (3, 'Dr. Yaw Asante',    'y.asante@medibook.clinic',  'Cardiology',       200.00, 'R-07'),
  (4, 'Dr. Akosua Darko',  'a.darko@medibook.clinic',   'General Practice',  80.00, 'R-01');

-- -----------------------------------------------------------------------------
-- Appointments
-- -----------------------------------------------------------------------------
SET @today = CURDATE();

-- Past, attended appointments (revenue already collected).
-- Kojo's 120.00 mirrors spreadsheet row AP-002 (paid less than the fee).
INSERT INTO appointments (patient_id, doctor_id, appt_datetime, amount_paid, booked_at) VALUES
  (1, 1, @today - INTERVAL 10 DAY + INTERVAL '09:00' HOUR_MINUTE, 150.00, @today - INTERVAL 30 DAY),
  (2, 1, @today - INTERVAL 10 DAY + INTERVAL '09:30' HOUR_MINUTE, 120.00, @today - INTERVAL 29 DAY),
  (1, 2, @today - INTERVAL  5 DAY + INTERVAL '10:00' HOUR_MINUTE, 100.00, @today - INTERVAL 28 DAY),
  (3, 3, @today - INTERVAL  3 DAY + INTERVAL '14:00' HOUR_MINUTE, 200.00, @today - INTERVAL 20 DAY);

-- Cancellation #1 — past slot, cancelled 30 h before it started → 50% refund.
INSERT INTO appointments
  (patient_id, doctor_id, appt_datetime, amount_paid, status, booked_at, cancelled_at, refund_amount)
VALUES
  (4, 3, @today - INTERVAL 2 DAY + INTERVAL '11:00' HOUR_MINUTE, 200.00, 'cancelled',
   @today - INTERVAL 15 DAY,
   @today - INTERVAL 2 DAY + INTERVAL '11:00' HOUR_MINUTE - INTERVAL 30 HOUR,
   100.00);

-- Cancellation #2 — future slot cancelled > 48 h ahead → 100% refund ...
INSERT INTO appointments
  (patient_id, doctor_id, appt_datetime, amount_paid, status, booked_at, cancelled_at, refund_amount)
VALUES
  (4, 3, @today + INTERVAL 4 DAY + INTERVAL '10:00' HOUR_MINUTE, 200.00, 'cancelled',
   @today - INTERVAL 6 DAY, @today - INTERVAL 1 DAY, 200.00);

-- ... and the SAME doctor/slot re-booked by another patient. Allowed because
-- the cancelled row's active_slot is NULL (see uq_appointments_doctor_slot).
INSERT INTO appointments (patient_id, doctor_id, appt_datetime, amount_paid, booked_at) VALUES
  (5, 3, @today + INTERVAL 4 DAY + INTERVAL '10:00' HOUR_MINUTE, 200.00, @today);

-- Dr. Boateng, day +3: 12 bookings = the daily cap (100% utilisation).
SET @busy = @today + INTERVAL 3 DAY;
INSERT INTO appointments (patient_id, doctor_id, appt_datetime, amount_paid, booked_at) VALUES
  (1, 1, @busy + INTERVAL '09:00' HOUR_MINUTE, 150.00, @today - INTERVAL 7 DAY),
  (2, 1, @busy + INTERVAL '09:30' HOUR_MINUTE, 150.00, @today - INTERVAL 7 DAY),
  (3, 1, @busy + INTERVAL '10:00' HOUR_MINUTE, 150.00, @today - INTERVAL 6 DAY),
  (4, 1, @busy + INTERVAL '10:30' HOUR_MINUTE, 150.00, @today - INTERVAL 6 DAY),
  (5, 1, @busy + INTERVAL '11:00' HOUR_MINUTE, 150.00, @today - INTERVAL 5 DAY),
  (6, 1, @busy + INTERVAL '11:30' HOUR_MINUTE, 150.00, @today - INTERVAL 5 DAY),
  (1, 1, @busy + INTERVAL '13:00' HOUR_MINUTE, 150.00, @today - INTERVAL 4 DAY),
  (2, 1, @busy + INTERVAL '13:30' HOUR_MINUTE, 150.00, @today - INTERVAL 4 DAY),
  (3, 1, @busy + INTERVAL '14:00' HOUR_MINUTE, 150.00, @today - INTERVAL 3 DAY),
  (4, 1, @busy + INTERVAL '14:30' HOUR_MINUTE, 150.00, @today - INTERVAL 2 DAY),
  (5, 1, @busy + INTERVAL '15:00' HOUR_MINUTE, 150.00, @today - INTERVAL 1 DAY),
  (6, 1, @busy + INTERVAL '15:30' HOUR_MINUTE, 150.00, @today);

-- Other upcoming bookings.
INSERT INTO appointments (patient_id, doctor_id, appt_datetime, amount_paid, booked_at) VALUES
  (6, 2, @today + INTERVAL 1 DAY + INTERVAL '09:00' HOUR_MINUTE, 100.00, @today - INTERVAL 3 DAY),
  (1, 2, @today + INTERVAL 6 DAY + INTERVAL '15:30' HOUR_MINUTE, 100.00, @today - INTERVAL 1 DAY),
  (3, 3, @today + INTERVAL 5 DAY + INTERVAL '16:30' HOUR_MINUTE, 200.00, @today);

-- Totals: 6 patients, 4 doctors, 22 appointments (20 booked, 2 cancelled).
