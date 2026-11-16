const $ = id => document.getElementById(id);
const originals = new Map([...document.querySelectorAll('[data-i]')].map(el => [el, el.innerHTML]));
const fa = {
  eyebrow: 'هارنس شما، مسیر کاری شما', title: 'یک محیط کار.<br>همهٔ مراحل، به‌هم‌پیوسته.', intro: 'تمام ATL را به دستیار خود اضافه کنید؛ تسک‌ها، مسیرهای مهندسی و پنل کنترل، در کنار هم.', full: 'تمام ATL در بسته', private: 'اطلاعات در پروژهٔ شما', install: 'بدون نصب جداگانهٔ ATL', frame: 'تعریف مسئله', build: 'ساخت', verify: 'راستی‌آزمایی', context: 'زمینهٔ مشترک پروژه', contextDesc: 'هارنس را عوض کنید؛ تسک‌ها و شواهد را نگه دارید.', review: 'اجرای کار در اختیار شماست', reviewDesc: 'پیش از اجرا، برنامه و اجراکننده را بررسی کنید.', connectTab: '۰۱ · اتصال هارنس', projectTab: '۰۲ · ورود به پروژه', choose: 'کجا کار می‌کنید؟', chooseDesc: 'هارنس خود را انتخاب کنید تا تنظیمات اتصال مناسب را بگیرید.', searchLabel: 'جست‌وجوی هارنس', noResults: 'موردی پیدا نشد. برای اتصال استاندارد MCP، «هارنس دیگر» را انتخاب کنید.', other: 'هارنس دیگر', step1: 'اتصال را اضافه کنید', merge: 'این ورودی را با تنظیمات خود ادغام کنید؛ سرورها و تنظیمات قبلی را نگه دارید.', step2: 'گفت‌وگو را شروع کنید', reload: 'ابزارهای MCP را در هارنس بازخوانی کنید، سپس این درخواست را بفرستید.', copyPrompt: 'کپی درخواست شروع', verification: 'این‌ها الگوهای اتصال هستند. نمایش ابزارهای ATL را در نسخهٔ نصب‌شدهٔ هارنس بررسی کنید.', download: 'دریافت فایل', copy: 'کپی تنظیمات', manual: 'هارنس من فرم تنظیمات دارد', transport: 'نوع اتصال: stdio · فرمان و آرگومان:', boundary: 'هر هارنس دارای ابزارهای MCP محلی می‌تواند از اتصال مشترک استفاده کند. چت‌های صرفاً تحت وب و کلاینت‌های صرفاً HTTP به آداپتر دیگری نیاز دارند. اتصال هارنس به معنی آماده‌بودن آن برای اجرای خودکار تسک‌ها نیست.', projectEyebrow: 'قدم بعدی شما', projectTitle: 'برای ایدهٔ بعدی‌تان جا باز کنید.', projectDesc: 'پوشهٔ موجود پروژه را باز کنید. ATL اطلاعات اولیهٔ موردنیاز را آماده می‌کند و شما را به پنل کامل کنترل می‌برد.', projectLabel: 'مسیر کامل پوشهٔ پروژه', projectHint: 'برنامهٔ خود را خارج از بستهٔ ATL انتخاب کنید. تسک‌های قبلی حفظ می‌شوند و اجراکننده‌ها شروع نمی‌شوند.', start: 'باز کردن پنل کنترل ←', enter: 'ورود به محیط کار ←', lifetime: 'هنگام استفاده از این محیط، ATL Connect را باز نگه دارید. تسک‌ها و شواهد پس از بسته‌شدن آن باقی می‌مانند.', footer: 'برای مهندسی سنجیده.',
};
let locale = 'en', profiles = [], selected, token;
try { locale = localStorage.getItem('atl-connect-language') === 'fa' ? 'fa' : 'en'; document.documentElement.classList.toggle('light', localStorage.getItem('atl-cp-theme') === 'light' || (!localStorage.getItem('atl-cp-theme') && matchMedia('(prefers-color-scheme: light)').matches)); } catch { /* storage is optional */ }
const text = (en, persian) => locale === 'fa' ? persian : en;
function announce(en, persian) { $('status').textContent = text(en, persian); }
function localize() {
  document.documentElement.lang = locale; document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
  for (const [el, original] of originals) el.innerHTML = locale === 'fa' ? fa[el.dataset.i] || original : original;
  $('language').textContent = locale === 'fa' ? 'English' : 'فارسی';
  $('search').placeholder = text('Find your harness…', 'جست‌وجوی هارنس…');
  $('theme').setAttribute('aria-label', text('Switch color theme', 'تغییر رنگ محیط'));
  $('hosts').setAttribute('aria-label', text('Harnesses', 'هارنس‌ها'));
  renderHosts(); if (selected) select(selected.id);
}
function renderHosts() {
  const query = $('search').value.trim().toLowerCase();
  $('hosts').replaceChildren();
  for (const profile of profiles.filter(p => (p.name + ' ' + p.id + (p.id === 'generic' ? ' دیگر' : '')).toLowerCase().includes(query))) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'host'; button.dataset.host = profile.id; button.setAttribute('aria-pressed', String(selected?.id === profile.id));
    const icon = document.createElement('span'); icon.className = 'host-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = profile.initials;
    const label = document.createElement('span'); label.textContent = profile.id === 'generic' ? text('Other harness', 'هارنس دیگر') : profile.name;
    const badge = document.createElement('small'); badge.textContent = profile.native ? text('Plugin + full runtime', 'پلاگین و تمام ATL') : text('Full ATL via MCP', 'تمام ATL با MCP'); label.append(badge);
    button.append(icon, label); button.addEventListener('click', () => select(profile.id)); $('hosts').append(button);
  }
  const empty = !$('hosts').children.length; $('no-results').hidden = !empty; $('other').hidden = !empty;
}
function select(id) {
  selected = profiles.find(p => p.id === id); if (!selected) return;
  for (const el of $('hosts').children) el.setAttribute('aria-pressed', String(el.dataset.host === id));
  $('profile-name').textContent = id === 'generic' ? text('Other harness', 'هارنس دیگر') : selected.name;
  $('profile-kind').textContent = selected.format === 'native' ? text('NATIVE PLUGIN', 'پلاگین بومی') : text('LOCAL MCP CONNECTION', 'اتصال محلی MCP');
  $('config-file').textContent = selected.file; $('config').textContent = selected.config;
  const profileNote = id === 'generic' ? text(selected.note, 'برای هارنس‌های دارای MCP محلی. اگر هارنس به‌جای JSON فرم دارد، فرمان و آرگومان بخش زیر را وارد کنید.') : id === 'deepseek' ? text(selected.note, 'بستهٔ DeepSeek را با مدیر پلاگین DSH اضافه کنید. این اتصال برای هارنس DSH است، نه چت تحت وب DeepSeek.') : '';
  $('profile-note').textContent = profileNote || text('Already using the native ATL plugin? You can skip this connection and open your project.', 'اگر پلاگین بومی ATL را دارید، از این اتصال بگذرید و پروژه را باز کنید.');
  $('config-label').textContent = selected.format === 'toml' ? 'TOML' : selected.format === 'native' ? 'DSH plugin' : 'JSON';
  $('manual-command').textContent = selected.command; $('manual-arg').textContent = selected.args[0];
  $('copy').disabled = selected.format === 'native'; $('download').disabled = selected.format === 'native';
}
function tab(project) {
  $('connection').hidden = project; $('project-panel').hidden = !project;
  $('connect-tab').setAttribute('aria-pressed', String(!project)); $('project-tab').setAttribute('aria-pressed', String(project));
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); announce('Copied. Paste it into your harness.', 'کپی شد. آن را در هارنس خود قرار دهید.'); }
  catch { announce('Clipboard unavailable. Select and copy the displayed text.', 'کلیپ‌بورد در دسترس نیست. متن نمایش‌داده‌شده را انتخاب و کپی کنید.'); }
}
$('language').onclick = () => { locale = locale === 'en' ? 'fa' : 'en'; try { localStorage.setItem('atl-connect-language', locale); } catch {} localize(); };
$('theme').onclick = () => { document.documentElement.classList.toggle('light'); try { localStorage.setItem('atl-cp-theme', document.documentElement.classList.contains('light') ? 'light' : 'dark'); } catch {} };
$('connect-tab').onclick = () => tab(false); $('project-tab').onclick = () => tab(true);
$('search').oninput = renderHosts; $('other').onclick = () => { $('search').value = ''; renderHosts(); select('generic'); };
$('copy').onclick = () => selected && copy(selected.config);
$('copy-prompt').onclick = () => selected && copy(locale === 'fa' ? 'ATL را برای برنامهٔ فعلی من آماده کن. مهارت atl را بخوان، مسیر کامل workspace را بگیر، atl_start را فراخوانی کن و لینک پنل کنترل را باز کن. فعلاً اجراکننده‌ها را شروع نکن.' : selected.prompt);
$('download').onclick = () => {
  if (!selected) return;
  const url = URL.createObjectURL(new Blob([selected.config + '\n'], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `atl-${selected.id}.${selected.format === 'toml' ? 'toml' : 'json'}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('Downloaded a connection snippet. Merge it into your settings.', 'فایل اتصال دریافت شد. آن را با تنظیمات قبلی ادغام کنید.');
};
$('project-form').onsubmit = async event => {
  event.preventDefault(); $('start').disabled = true; $('project-link').hidden = true;
  $('project-status').classList.remove('error'); $('project-status').textContent = text('Preparing your workspace…', 'در حال آماده‌سازی محیط کار…');
  try {
    const response = await fetch('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ATL-Token': token }, body: JSON.stringify({ project: $('project').value.trim() }) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error);
    $('project-status').textContent = text('Your workspace is ready. No workers were started.', 'محیط کار آماده است. اجراکننده‌ای شروع نشده است.');
    $('project-link').href = value.url; $('project-link').hidden = false;
  } catch (error) { $('project-status').textContent = text('Could not open this project. Check the absolute folder path. ', 'پروژه باز نشد. مسیر کامل پوشه را بررسی کنید. ') + error.message; $('project-status').classList.add('error'); }
  finally { $('start').disabled = false; }
};
localize();
fetch('/api/connect').then(response => { if (!response.ok) throw new Error('Connection unavailable'); return response.json(); }).then(value => { profiles = value.profiles; token = value.token; renderHosts(); select('claude'); }).catch(() => { $('start').disabled = true; announce('ATL Connect is unavailable. Restart it and reload this page.', 'اتصال ATL در دسترس نیست. آن را دوباره اجرا کرده و صفحه را بازخوانی کنید.'); });
