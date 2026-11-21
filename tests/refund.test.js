// Refund policy (documented in src/utils/refund.js and docs/API.md):
//   notice  > 48 h          → 100 %
//   24 h <= notice <= 48 h  →  50 %   (both boundaries belong to the 50 % tier)
//   notice  < 24 h          →   0 %
const { calculateRefund } = require('../src/utils/refund');

const HOUR = 60 * 60 * 1000;
const appointment = new Date(2026, 11, 10, 10, 0, 0); // 10 Dec 2026, 10:00 local
const cancelledBefore = (ms) => new Date(appointment.getTime() - ms);

describe('calculateRefund', () => {
  test('more than 48 hours notice refunds 100% of the amount paid', () => {
    const r = calculateRefund(150, appointment, cancelledBefore(72 * HOUR));
    expect(r.percentage).toBe(100);
    expect(r.amount).toBe(150);
    expect(r.noticeHours).toBe(72);
  });

  test('boundary: exactly 48 hours is 50%, one millisecond more is 100%', () => {
    expect(calculateRefund(150, appointment, cancelledBefore(48 * HOUR))).toMatchObject({ percentage: 50, amount: 75 });
    expect(calculateRefund(150, appointment, cancelledBefore(48 * HOUR + 1))).toMatchObject({ percentage: 100, amount: 150 });
  });

  test('between 24 and 48 hours refunds 50%, rounded to whole cents', () => {
    expect(calculateRefund(200, appointment, cancelledBefore(36 * HOUR))).toMatchObject({ percentage: 50, amount: 100 });
    // 50% of 99.99 = 49.995 → rounds half up to 50.00, never a fraction of a cent.
    expect(calculateRefund('99.99', appointment, cancelledBefore(30 * HOUR)).amount).toBe(50);
  });

  test('boundary: exactly 24 hours is 50%, one millisecond less is 0%', () => {
    expect(calculateRefund(150, appointment, cancelledBefore(24 * HOUR))).toMatchObject({ percentage: 50, amount: 75 });
    expect(calculateRefund(150, appointment, cancelledBefore(24 * HOUR - 1))).toMatchObject({ percentage: 0, amount: 0 });
  });

  test('less than 24 hours notice refunds nothing', () => {
    const r = calculateRefund(150, appointment, cancelledBefore(2 * HOUR));
    expect(r).toEqual({ percentage: 0, amount: 0, noticeHours: 2 });
  });
});
