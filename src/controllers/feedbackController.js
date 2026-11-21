const { resolveLang, getLocale, formatToday, supportedLanguages } = require('../utils/i18n');
const { renderForm, renderThankYou } = require('../views/feedbackPage');
const { audit } = require('../utils/auditLogger');

function context(req) {
  const lang = resolveLang(req.query.lang); // unsupported → 'en', never throws
  return { lang, locale: getLocale(lang), today: formatToday(lang), languages: supportedLanguages() };
}

/** GET /feedback?lang=fr */
function show(req, res) {
  const ctx = context(req);
  res.set('Content-Language', ctx.lang).type('html').send(renderForm(ctx));
}

/** POST /feedback?lang=fr  (form fields q1..q5) */
function submit(req, res) {
  const ctx = context(req);
  const body = req.body || {};
  const answers = ctx.locale.questions.map((_, i) => {
    const v = body[`q${i + 1}`];
    return typeof v === 'string' ? v.trim().slice(0, 5000) : '';
  });

  if (answers.some((a) => a === '')) {
    // Re-show the form in the same language, keeping what was already typed.
    return res.status(400).set('Content-Language', ctx.lang).type('html')
      .send(renderForm({ ...ctx, answers, error: ctx.locale.errorRequired }));
  }

  // No extra table allowed, so feedback goes to the audit log (async, never fails the request).
  audit('FEEDBACK_SUBMITTED', { lang: ctx.lang, answers });
  res.set('Content-Language', ctx.lang).type('html').send(renderThankYou(ctx));
}

module.exports = { show, submit };
