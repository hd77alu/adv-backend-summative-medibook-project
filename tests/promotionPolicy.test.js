// Waitlist promotion rules used by the worker (src/worker.js).
const { isEligible, classifyPromotionFailure } = require('../src/queue/promotionPolicy');
const { AppError } = require('../src/utils/errors');

describe('waitlist promotion policy', () => {
  test('a freed slot goes only to patients who can take it', () => {
    const wholeDay = { patient_id: 1, any_slot: true, requested_datetime: '2026-11-24 10:00:00' };
    const oneSlot = { patient_id: 2, any_slot: false, requested_datetime: '2026-11-24 10:00:00' };

    expect(isEligible(wholeDay, '2026-11-24 15:30:00')).toBe(true);  // day was full → any freed slot
    expect(isEligible(oneSlot, '2026-11-24 10:00:00')).toBe(true);   // the exact slot they wanted
    expect(isEligible(oneSlot, '2026-11-24 15:30:00')).toBe(false);  // a different slot → skip them
    expect(isEligible(null, '2026-11-24 10:00:00')).toBe(false);
  });

  test('a failed promotion never silently loses the patient', () => {
    // Patient deleted: drop the entry (audited) and offer the slot to the next person.
    expect(classifyPromotionFailure(new AppError(404, 'gone', { code: 'PATIENT_NOT_FOUND' }))).toBe('DROP');
    // Problem is the slot, not the patient → back to the front of the queue.
    expect(classifyPromotionFailure(new AppError(409, 'taken', { code: 'SLOT_TAKEN' }))).toBe('SLOT_UNAVAILABLE');
    expect(classifyPromotionFailure(new AppError(409, 'full', { code: 'DOCTOR_DAY_FULL' }))).toBe('SLOT_UNAVAILABLE');
    expect(classifyPromotionFailure(new AppError(422, 'past', { code: 'IN_PAST' }))).toBe('SLOT_UNAVAILABLE');
    // Database down / unknown error → patient kept, job retried.
    expect(classifyPromotionFailure(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toBe('RETRY');
    expect(classifyPromotionFailure(undefined)).toBe('RETRY');
  });
});
