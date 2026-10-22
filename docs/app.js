const dialog = document.querySelector('#search-dialog');
const searchButton = document.querySelector('#search-open');
const searchInput = document.querySelector('#search-input');
const searchResults = document.querySelector('#search-results');
const themeToggle = document.querySelector('#theme-toggle');
const navItems = [...document.querySelectorAll('.nav-item[data-section]')];
const sections = navItems.map((item) => document.getElementById(item.dataset.section)).filter(Boolean);

function setActiveSection(id) {
  navItems.forEach((item) => {
    const active = item.dataset.section === id;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  const activeItem = navItems.find((item) => item.dataset.section === id);
  const crumb = document.querySelector('.crumbs .current');
  if (crumb && activeItem) crumb.textContent = activeItem.textContent.trim();
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    setActiveSection(item.dataset.section);
    if (history.pushState) history.pushState(null, '', item.getAttribute('href'));
  });
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setActiveSection(visible.target.id);
  }, { rootMargin: '-18% 0px -68% 0px', threshold: [0.05, 0.25, 0.6] });
  sections.forEach((section) => observer.observe(section));
}

function openSearch() {
  if (!dialog?.open) dialog?.showModal();
  searchInput?.focus();
  renderSearchResults('');
}

searchButton?.addEventListener('click', openSearch);

themeToggle?.addEventListener('click', () => {
  document.body.classList.toggle('light');
  themeToggle.textContent = document.body.classList.contains('light') ? '☾' : '☼';
  themeToggle.setAttribute('aria-pressed', String(document.body.classList.contains('light')));
});

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1400);
  } catch { button.textContent = 'Select'; }
}

document.querySelector('#copy-prompt')?.addEventListener('click', (event) => {
  copyText('The checkout callback fails only in production. Trace the contract boundaries and prove the real runtime behavior.', event.currentTarget);
});

document.querySelectorAll('.copy-example').forEach((button) => {
  button.addEventListener('click', (event) => {
    const prompt = event.currentTarget.closest('.prompt-sample')?.querySelector('code')?.textContent ?? '';
    copyText(prompt.replace(/^\$atl\s*/, ''), event.currentTarget);
  });
});

// Site-wide search: every page carries the dialog; results cover all pages.
const SEARCH_PAGES = [
  { page: 'index.html', label: 'Overview' },
  { page: 'skills.html', label: 'Skills' },
  { page: 'guides.html', label: 'Guides' },
  { page: 'reference.html', label: 'Reference' },
  { page: 'team.html', label: 'Team' },
  { page: 'jev.html', label: 'Jev routing' },
  { page: 'diagrams.html', label: 'Diagrams' },
  { page: 'codex-history-bridge.html', label: 'Codex history bridge' },
];
let searchIndexPromise = null;

function loadSearchIndex() {
  if (!searchIndexPromise) {
    searchIndexPromise = Promise.all(SEARCH_PAGES.map(async ({ page, label }) => {
      const response = await fetch(page);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${page}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const entries = [];
      doc.querySelectorAll('main section[id]').forEach((section) => {
        const heading = section.querySelector('h1,h2,h3');
        entries.push({
          href: `${page}#${section.id}`,
          title: `${label} — ${heading ? heading.textContent.trim() : section.id}`,
          text: section.textContent.toLowerCase().replace(/\s+/g, ' ').slice(0, 4000),
        });
      });
      return entries;
    })).then((groups) => groups.flat());
    searchIndexPromise.catch(() => { searchIndexPromise = null; });
  }
  return searchIndexPromise;
}

async function renderSearchResults(query) {
  if (!searchResults) return;
  const normalized = query.trim().toLowerCase();
  let index;
  try {
    index = await loadSearchIndex();
  } catch {
    searchResults.innerHTML = '<p class="no-results">Search needs the site served over HTTP (it works on the published site and via a local server).</p>';
    return;
  }
  const wanted = ['index.html#quickstart', 'reference.html#concepts', 'reference.html#evidence', 'team.html#doc-install', 'skills.html#', 'guides.html#prompting', 'jev.html#choose', 'diagrams.html#'];
  const matches = normalized
    ? index.filter((item) => `${item.title} ${item.text}`.includes(normalized)).slice(0, 8)
    : wanted.map((prefix) => index.find((item) => item.href.startsWith(prefix))).filter(Boolean).slice(0, 6);
  searchResults.innerHTML = matches.length
    ? matches.map((item) => `<a href="${item.href}" data-search-result="${item.href}"><strong>${item.title}</strong><span>Open ↗</span></a>`).join('')
    : '<p class="no-results">No matching section. Try “route”, “evidence”, or “production”.</p>';
  searchResults.querySelectorAll('[data-search-result]').forEach((result) => {
    result.addEventListener('click', () => dialog.close());
  });
}

searchInput?.addEventListener('input', (event) => renderSearchResults(event.target.value));

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openSearch();
  }
  if (event.key === 'Escape' && dialog?.open) dialog.close();
});

// Code cards: copy button on every .code-card
document.querySelectorAll('.copy-code').forEach((button) => {
  button.addEventListener('click', () => {
    const code = button.closest('.code-card')?.querySelector('pre')?.textContent ?? '';
    copyText(code.replace(/\n+$/, ''), button);
  });
});

// On-this-page rail: highlight the section currently in view
const tocLinks = [...document.querySelectorAll('.doc-toc a[href^="#"]')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const tocMap = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  const spy = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    tocLinks.forEach((a) => {
      const active = a === tocMap.get(visible.target.id);
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  }, { rootMargin: '-15% 0px -70% 0px', threshold: [0.05, 0.25, 0.6] });
  tocMap.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) spy.observe(el);
  });
}
