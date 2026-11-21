// Pure waitlist-promotion rules (no Redis, no DB) — unit-tested in Part F.

/**
 * Can this waitlist entry take the slot that was just freed?
 *  - any_slot = true  → the patient joined because the doctor's whole DAY was
 *                       full, so any freed slot on that day is acceptable.
 *  - any_slot = false → the patient wanted one specific slot (the day had
 *                       other free slots), so only that exact slot will do.
 */
function isEligible(entry, freedDatetime) {
  if (!entry || typeof entry !== 'object') return false;
  return entry.any_slot === true || entry.requested_datetime === freedDatetime;
}

/**
 * What to do with a waitlisted patient when booking them into the freed
 * slot throws. The patient must never silently vanish, so every outcome is
 * explicit:
 *
 *  'DROP'             — the patient no longer exists (deleted). Remove the
 *                       entry (audited) and offer the slot to the next person.
 *  'SLOT_UNAVAILABLE' — the problem is the SLOT, not the patient: someone else
 *                       booked it first (409), the day filled up again (409),
 *                       or it is now in the past (422). Put the patient back
 *                       at the FRONT of the waitlist; this job is finished.
 *  'RETRY'            — anything else (database down, unexpected bug): a
 *                       transient failure. Put the patient back at the front
 *                       and fail the job so the worker retries it later.
 */
function classifyPromotionFailure(err) {
  if (!err || typeof err !== 'object') return 'RETRY';
  if (err.status === 404 && err.code === 'PATIENT_NOT_FOUND') return 'DROP';
  if (err.status === 409 || err.status === 422 || err.status === 404) return 'SLOT_UNAVAILABLE';
  return 'RETRY';
}

module.exports = { isEligible, classifyPromotionFailure };
