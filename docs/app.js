const dialog = document.querySelector('#search-dialog');
const searchButton = document.querySelector('#search-open');
const searchInput = document.querySelector('#search-input');
const themeToggle = document.querySelector('#theme-toggle');
const copyButton = document.querySelector('#copy-prompt');

searchButton?.addEventListener('click', () => { dialog.showModal(); searchInput.focus(); });
themeToggle?.addEventListener('click', () => {
  document.body.classList.toggle('light');
  themeToggle.textContent = document.body.classList.contains('light') ? '☾' : '☼';
});
copyButton?.addEventListener('click', async () => {
  await navigator.clipboard?.writeText('The checkout callback fails only in production…');
  copyButton.textContent = 'Copied';
  setTimeout(() => { copyButton.textContent = 'Copy'; }, 1400);
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); dialog.showModal(); searchInput.focus();
  }
});
