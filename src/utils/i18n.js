// Part G — minimal i18n: locale files in /locales, one JSON per language.
//
// Locale files are read ONCE at start-up (not inside request handlers) and
// validated, so a broken or incomplete translation stops the server with a
// clear message instead of rendering a half-translated page at runtime.
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '..', '..', 'locales');
const DEFAULT_LANG = 'en';
const QUESTION_COUNT = 5;
const REQUIRED_KEYS = [
  'title', 'heading', 'dateLabel', 'instructions', 'questions', 'answerPlaceholder',
  'submit', 'languageLabel', 'thankYouTitle', 'thankYouMessage', 'backLink', 'errorRequired',
];

function loadLocales() {
  const locales = {};
  for (const file of fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'))) {
    const lang = path.basename(file, '.json');
    const data = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    const missing = REQUIRED_KEYS.filter((k) => data[k] === undefined);
    if (missing.length) throw new Error(`locales/${file} is missing: ${missing.join(', ')}`);
    if (!Array.isArray(data.questions) || data.questions.length !== QUESTION_COUNT) {
      throw new Error(`locales/${file} must contain exactly ${QUESTION_COUNT} questions`);
    }
    if (!data.meta?.intlLocale) throw new Error(`locales/${file} is missing meta.intlLocale`);
    locales[lang] = data;
  }
  if (!locales[DEFAULT_LANG]) throw new Error(`locales/${DEFAULT_LANG}.json (the default language) is required`);
  return locales;
}

const locales = loadLocales();

/**
 * Picks a supported language from a ?lang= value. Anything unsupported or
 * malformed — missing, 'de', '', an array from ?lang=a&lang=b, '../etc' —
 * falls back to English. Region tags are reduced to the language: 'fr-CA' → 'fr'.
 */
function resolveLang(raw) {
  if (typeof raw !== 'string') return DEFAULT_LANG;
  const lang = raw.trim().toLowerCase().split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(locales, lang) ? lang : DEFAULT_LANG;
}

function getLocale(lang) {
  return locales[resolveLang(lang)];
}

/** Today's date formatted for the active locale, e.g. "Saturday 21 November 2026" / "samedi 21 novembre 2026". */
function formatToday(lang, now = new Date()) {
  return new Intl.DateTimeFormat(getLocale(lang).meta.intlLocale, { dateStyle: 'full' }).format(now);
}

const supportedLanguages = () => Object.entries(locales).map(([code, l]) => ({ code, name: l.meta.language }));

module.exports = { resolveLang, getLocale, formatToday, supportedLanguages, DEFAULT_LANG };
