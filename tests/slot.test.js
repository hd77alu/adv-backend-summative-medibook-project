// Slot validation: future, 09:00–17:00 working hours, 30-minute boundaries.
// The clinic closes at 17:00, so the last bookable slot STARTS at 16:30.
const { validateSlot } = require('../src/utils/slot');

const now = new Date(2026, 10, 21, 12, 0, 0); // fixed "now": 21 Nov 2026, 12:00 local

describe('validateSlot', () => {
  test('accepts the first (09:00) and last (16:30) slots and normalises the format', () => {
    expect(validateSlot('2026-12-01 09:00', now)).toMatchObject({
      ok: true, datetime: '2026-12-01 09:00:00', date: '2026-12-01',
    });
    // "T" separator and explicit :00 seconds are accepted too.
    expect(validateSlot('2026-12-01T16:30:00', now)).toMatchObject({ ok: true, datetime: '2026-12-01 16:30:00' });
  });

  test('edge cases: 17:00 and 08:30 are outside hours; 09:15 and 09:30:10 are off the slot grid', () => {
    expect(validateSlot('2026-12-01 17:00', now)).toMatchObject({ ok: false, reason: 'OUTSIDE_HOURS' });
    expect(validateSlot('2026-12-01 08:30', now)).toMatchObject({ ok: false, reason: 'OUTSIDE_HOURS' });
    expect(validateSlot('2026-12-01 09:15', now)).toMatchObject({ ok: false, reason: 'NOT_ON_SLOT' });
    expect(validateSlot('2026-12-01 09:30:10', now)).toMatchObject({ ok: false, reason: 'NOT_ON_SLOT' });
  });

  test('rejects malformed input and times that are not strictly in the future', () => {
    for (const bad of ['tomorrow', '2026-02-30 10:00', '2026-12-01T09:00Z', '01/12/2026 09:00', '', null, 42]) {
      expect(validateSlot(bad, now)).toMatchObject({ ok: false, reason: 'MALFORMED' });
    }
    expect(validateSlot('2026-11-20 10:00', now)).toMatchObject({ ok: false, reason: 'IN_PAST' });
    expect(validateSlot('2026-11-21 12:00', now)).toMatchObject({ ok: false, reason: 'IN_PAST' }); // exactly now
    expect(validateSlot('2026-11-21 12:30', now)).toMatchObject({ ok: true });                     // next slot today
  });
});
