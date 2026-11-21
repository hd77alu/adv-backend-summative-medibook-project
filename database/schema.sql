-- =============================================================================
-- MediBook — Clinic Appointment System
-- database/schema.sql  (MySQL 8.0.16+ — required for enforced CHECK constraints)
--
-- Normalised (3NF) from the clinic spreadsheet into exactly 3 entities:
--   patients (1) ──< appointments >── (1) doctors
--
-- Run on a fresh server:   mysql -u root -p < database/schema.sql
-- =============================================================================

DROP DATABASE IF EXISTS medibook;
CREATE DATABASE medibook
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE medibook;

-- -----------------------------------------------------------------------------
-- patients — one row per person (removes the repeated name/email/phone
-- that appeared on every spreadsheet row for the same patient).
-- -----------------------------------------------------------------------------
CREATE TABLE patients (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  full_name   VARCHAR(100)  NOT NULL,
  email       VARCHAR(255)  NOT NULL,
  phone       VARCHAR(20)   NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_patients        PRIMARY KEY (id),
  CONSTRAINT uq_patients_email  UNIQUE (email),
  CONSTRAINT chk_patients_name  CHECK (CHAR_LENGTH(TRIM(full_name)) > 0),
  CONSTRAINT chk_patients_email CHECK (email LIKE '_%@_%._%'),
  CONSTRAINT chk_patients_phone CHECK (phone REGEXP '^\\+?[0-9][0-9 -]{6,18}$')
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- doctors — specialty, fee and room depend only on the doctor, so they live
-- here (in the spreadsheet they were transitively dependent on appt_ref
-- via doctor_name: a 3NF violation).
-- -----------------------------------------------------------------------------
CREATE TABLE doctors (
  id                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  full_name         VARCHAR(100)   NOT NULL,
  email             VARCHAR(255)   NOT NULL,
  specialty         VARCHAR(100)   NOT NULL,
  consultation_fee  DECIMAL(10,2)  NOT NULL,
  room              VARCHAR(10)    NOT NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_doctors        PRIMARY KEY (id),
  CONSTRAINT uq_doctors_email  UNIQUE (email),
  CONSTRAINT chk_doctors_name  CHECK (CHAR_LENGTH(TRIM(full_name)) > 0),
  CONSTRAINT chk_doctors_email CHECK (email LIKE '_%@_%._%'),
  CONSTRAINT chk_doctors_fee   CHECK (consultation_fee >= 0),
  CONSTRAINT chk_doctors_room  CHECK (CHAR_LENGTH(TRIM(room)) > 0)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- appointments — the associative entity linking a patient to a doctor at a
-- specific slot. It also carries the cancellation/refund record (no extra
-- table allowed), so a cancelled row is KEPT for refund history.
--
-- amount_paid is stored per appointment on purpose: it is a fact about this
-- booking (AP-002 paid 120.00 while the fee was 150.00), not a copy of
-- doctors.consultation_fee, so it is not a transitive dependency.
--
-- "A doctor cannot have two appointments at the same date/time":
--   active_slot is a generated column = 1 while the appointment is 'booked'
--   and NULL once 'cancelled'. UNIQUE (doctor_id, appt_datetime, active_slot)
--   therefore blocks two ACTIVE bookings of the same doctor slot, while any
--   number of cancelled rows (active_slot = NULL — NULLs never collide in a
--   unique index) can coexist with a new active booking of that slot.
--   This index is also the final race-condition guard: if two requests
--   insert the same slot at the same instant, InnoDB rejects the second
--   with ER_DUP_ENTRY (mapped to HTTP 409 by the API).
-- -----------------------------------------------------------------------------
CREATE TABLE appointments (
  id             INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  patient_id     INT UNSIGNED   NOT NULL,
  doctor_id      INT UNSIGNED   NOT NULL,
  appt_datetime  DATETIME       NOT NULL,
  amount_paid    DECIMAL(10,2)  NOT NULL,
  status         ENUM('booked','cancelled') NOT NULL DEFAULT 'booked',
  booked_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at   DATETIME       NULL DEFAULT NULL,
  refund_amount  DECIMAL(10,2)  NULL DEFAULT NULL,
  -- Derived, never written by the application:
  appt_date      DATE AS (DATE(appt_datetime)) STORED,
  active_slot    TINYINT AS (IF(status = 'booked', 1, NULL)) STORED,
  CONSTRAINT pk_appointments PRIMARY KEY (id),
  CONSTRAINT fk_appointments_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_doctor  FOREIGN KEY (doctor_id)
    REFERENCES doctors (id)  ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Business rule: one active booking per doctor per slot.
  CONSTRAINT uq_appointments_doctor_slot UNIQUE (doctor_id, appt_datetime, active_slot),
  -- Business rule: 30-minute slot boundary (hh:00:00 or hh:30:00).
  CONSTRAINT chk_appt_slot_boundary CHECK (
    MINUTE(appt_datetime) IN (0, 30) AND SECOND(appt_datetime) = 0
  ),
  -- Business rule: working hours 09:00–17:00 → last slot starts at 16:30.
  CONSTRAINT chk_appt_working_hours CHECK (
    TIME(appt_datetime) BETWEEN '09:00:00' AND '16:30:00'
  ),
  CONSTRAINT chk_appt_amount_paid CHECK (amount_paid >= 0),
  -- Cancellation record is all-or-nothing: a cancelled row MUST have both
  -- cancelled_at and refund_amount; a booked row must have neither.
  CONSTRAINT chk_appt_cancel_record CHECK (
    (status = 'booked'    AND cancelled_at IS NULL     AND refund_amount IS NULL) OR
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND refund_amount IS NOT NULL)
  ),
  -- A refund can never exceed what was paid.
  CONSTRAINT chk_appt_refund_range CHECK (
    refund_amount IS NULL OR (refund_amount >= 0 AND refund_amount <= amount_paid)
  ),
  -- Supports the 12-per-day cap check, stats and the busy-days report.
  INDEX idx_appointments_doctor_day (doctor_id, appt_date, status),
  INDEX idx_appointments_patient   (patient_id)
) ENGINE = InnoDB;

-- Rules that cannot be expressed as constraints and are enforced in the API
-- (inside a transaction that locks the doctor row with SELECT ... FOR UPDATE):
--   * appt_datetime must be in the future (CHECK cannot use NOW()).
--   * at most 12 'booked' appointments per doctor per appt_date
--     (a CHECK cannot count other rows).
