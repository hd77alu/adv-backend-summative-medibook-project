// Server-rendered HTML for the feedback page. Every value is HTML-escaped,
// including translations and anything the user typed.
const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STYLES = `
  :root { --ink:#1f2937; --muted:#6b7280; --line:#d1d5db; --accent:#1e3a5f; --bg:#f3f4f6; --card:#fff; --err:#b91c1c; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif; color:var(--ink); background:var(--bg); line-height:1.5; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 48px; }
  header { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:baseline; gap:8px 16px; }
  h1 { font-size: 1.6rem; margin: 0; color: var(--accent); }
  nav a { margin-left: 8px; color: var(--accent); }
  nav a[aria-current="true"] { font-weight: 700; text-decoration: none; }
  .date { color: var(--muted); margin: 4px 0 20px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 24px; }
  .instructions { margin-top: 0; }
  ol { padding-left: 1.2rem; }
  li { margin-bottom: 22px; }
  label { display:block; font-weight: 600; margin-bottom: 6px; }
  textarea { width:100%; min-height: 110px; padding:10px; font: inherit; border:1px solid var(--line); border-radius:8px; resize: vertical; }
  textarea:focus { outline: 2px solid var(--accent); border-color: transparent; }
  button { background: var(--accent); color:#fff; border:0; border-radius:8px; padding: 10px 20px; font: inherit; font-weight:600; cursor:pointer; }
  .error { color: var(--err); font-weight: 600; }
`;

function layout({ lang, locale, today, languages, body }) {
  const nav = languages.map(({ code, name }) =>
    `<a href="/feedback?lang=${escapeHtml(code)}" hreflang="${escapeHtml(code)}"${code === lang ? ' aria-current="true"' : ''}>${escapeHtml(name)}</a>`).join('');
  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${escapeHtml(locale.meta.dir || 'ltr')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(locale.title)}</title>
  <style>${STYLES}</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(locale.heading)}</h1>
    <nav aria-label="${escapeHtml(locale.languageLabel.replace(/\s*:\s*$/, ''))}">${escapeHtml(locale.languageLabel)} ${nav}</nav>
  </header>
  <p class="date">${escapeHtml(locale.dateLabel)} <time>${escapeHtml(today)}</time></p>
  ${body}
</main>
</body>
</html>`;
}

/** The form with exactly 5 essay questions, each answered in a <textarea>. */
function renderForm({ lang, locale, today, languages, answers = [], error = null }) {
  const items = locale.questions.map((q, i) => `
      <li>
        <label for="q${i + 1}">${escapeHtml(q)}</label>
        <textarea id="q${i + 1}" name="q${i + 1}" required maxlength="5000"
          placeholder="${escapeHtml(locale.answerPlaceholder)}">${escapeHtml(answers[i] || '')}</textarea>
      </li>`).join('');

  return layout({
    lang, locale, today, languages,
    body: `
  <form class="card" method="post" action="/feedback?lang=${escapeHtml(lang)}">
    <p class="instructions">${escapeHtml(locale.instructions)}</p>
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
    <ol>${items}
    </ol>
    <button type="submit">${escapeHtml(locale.submit)}</button>
  </form>`,
  });
}

function renderThankYou({ lang, locale, today, languages }) {
  return layout({
    lang, locale, today, languages,
    body: `
  <section class="card">
    <h2>${escapeHtml(locale.thankYouTitle)}</h2>
    <p>${escapeHtml(locale.thankYouMessage)}</p>
    <p><a href="/feedback?lang=${escapeHtml(lang)}">${escapeHtml(locale.backLink)}</a></p>
  </section>`,
  });
}

module.exports = { renderForm, renderThankYou, escapeHtml };
