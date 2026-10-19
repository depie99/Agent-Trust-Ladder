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

function renderSearchResults(query) {
  if (!searchResults) return;
  const normalized = query.trim().toLowerCase();
  const searchable = sections.map((section) => ({
    id: section.id,
    title: section.querySelector('h1,h2,h3')?.textContent.trim() || section.id,
    text: section.textContent.toLowerCase(),
  }));
  const matches = normalized ? searchable.filter((item) => `${item.title} ${item.text}`.includes(normalized)).slice(0, 6) : searchable.slice(0, 5);
  searchResults.innerHTML = matches.length
    ? matches.map((item) => `<a href="#${item.id}" data-search-result="${item.id}"><strong>${item.title}</strong><span>Open section ↗</span></a>`).join('')
    : '<p class="no-results">No matching section. Try “route”, “evidence”, or “production”.</p>';
  searchResults.querySelectorAll('[data-search-result]').forEach((result) => {
    result.addEventListener('click', () => { setActiveSection(result.dataset.searchResult); dialog.close(); });
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
