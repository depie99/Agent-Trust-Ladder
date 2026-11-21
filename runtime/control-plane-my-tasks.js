(() => {
  'use strict';
  let context, latest, preferences, preferenceKey, opened, generation = 0, mermaidPromise;
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fa = () => context?.locale === 'fa-IR';
  const t = (english, persian) => fa() ? persian : english;
  const ownButton = (label, action, cls = '') => `<button type="button" class="btn ${cls}" data-mtr-action="${e(action)}">${e(label)}</button>`;
  const api = async (url, body) => {
    if (body !== undefined) return context.api(url, body);
    const response = await fetch(url, { cache: 'no-store' }), data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Request failed');
    return data;
  };
  function savePreferences() { try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* private mode */ } }
  function repaint() {
    const root = document.querySelector('.mtr-root');
    if (root && latest) root.outerHTML = render(...latest);
  }
  const stateLabel = state => ({ proposed: t('To Do', 'برای انجام'), inprogress: t('In Progress', 'در حال انجام'), complete: t('Done', 'انجام‌شده') })[state];
  const cardStateLabel = item => item.state?.toLowerCase() === 'new' ? t('Not started', 'شروع‌نشده') : item.state;
  const initialLimit = () => preferences.view === 'kanban' ? 12 : 6;
  const flowLinks = diagram => `<ul class="mtr-flow-links">${diagram.edges.map(edge => `<li dir="auto">${e(diagram.nodes[edge.from].label)} → ${e(diagram.nodes[edge.to].label)}</li>`).join('')}</ul>`;
  const priorityKey = item => item.source === 'jira' ? item.source_priority?.label || '' : item.priority ? `P${item.priority}` : '';
  const sourceLabel = item => item.source === 'jira' ? 'Jira' : 'Azure Boards';
  const priorityTone = item => ({ 1: 'red', 2: 'amber', 3: 'blue' })[item.source_priority?.rank ?? item.priority] || '';
  const priorityLabel = item => item.source === 'jira' ? item.source_priority?.label || t('No priority', 'بدون اولویت') : item.priority ? `${({ 1: t('Critical', 'بحرانی'), 2: t('High', 'بالا'), 3: t('Normal', 'معمولی'), 4: t('Low', 'پایین') })[item.priority] || t('Priority', 'اولویت')} (P${item.priority})` : t('No priority', 'بدون اولویت');
  const urgencyLabel = item => item.state_category === 'complete' ? t('Completed', 'انجام‌شده') : item.triage?.score != null ? t(`ATL urgency: ${item.triage.score}/100`, `فوریت ATL: ${item.triage.score}/۱۰۰`) : t('Urgency unknown', 'فوریت نامشخص');
  // Spec 022 preparation states — derived server-side, shown next to (never
  // merged with) the review and approval states.
  const prepLabels = { not_prepared: ['Not prepared', 'آماده نشده'], needs_investigation: ['Needs investigation', 'نیازمند بررسی'], needs_answer: ['Needs your answer', 'پاسخ شما لازم است'], ready: ['Ready to plan', 'آمادهٔ برنامه‌ریزی'], historical: ['Historical', 'تاریخی'] };
  const prepLabel = status => { const pair = prepLabels[status]; return pair ? t(pair[0], pair[1]) : String(status || ''); };
  const prepTone = status => ({ ready: 'green', needs_answer: 'amber' })[status] || 'blue';
  const prepStatusOf = item => item.prep_status || (item.state_category === 'complete' ? 'historical' : 'not_prepared');
  function advancedFilters(all) {
    const select = (name, label, values) => `<label><span>${e(label)}</span><select class="input" data-mtr-filter="${name}">${values.map(([value, text]) => `<option value="${e(value)}" ${preferences[name] === value ? 'selected' : ''}>${e(text)}</option>`).join('')}</select></label>`;
    return `<details class="mtr-more-filters" ${preferences.advanced ? 'open' : ''}><summary>${e(t('More filters & sorting', 'فیلترهای بیشتر و مرتب‌سازی'))}</summary><div class="mtr-filters is-advanced">${select('source', t('Source', 'منبع'), [['', t('All sources', 'همهٔ منابع')], ['azure', 'Azure'], ['jira', 'Jira']])}${select('priority', t('Priority', 'اولویت'), [['', t('All priorities', 'همهٔ اولویت‌ها')], ...[...new Set(all.map(priorityKey))].map(v => [v, v])])}${select('urgency', t('Urgency', 'فوریت'), [['', t('All urgency levels', 'همهٔ سطح‌ها')], ['urgent', t('Urgent', 'فوری')], ['high', t('High', 'بالا')], ['normal', t('Normal', 'معمولی')], ['low', t('Low', 'پایین')], ['unknown', t('Unknown', 'نامشخص')]])}${select('prep', t('Preparation', 'آماده‌سازی'), [['', t('All preparation', 'همهٔ وضعیت‌های آماده‌سازی')], ['needs_investigation', prepLabel('needs_investigation')], ['needs_answer', prepLabel('needs_answer')], ['ready', prepLabel('ready')], ['not_prepared', prepLabel('not_prepared')]])}${select('sort', t('Sort by', 'مرتب‌سازی'), [['urgency', t('ATL urgency', 'فوریت ATL')], ['priority', t('Source priority', 'اولویت منبع')], ['updated', t('Last updated', 'آخرین تغییر')]])}</div></details>`;
  }
  function card(item) {
    const done = item.state_category === 'complete';
    const brief = item.brief || (item.description_text || '').split('\n').find(Boolean) || t('Task brief is being prepared.', 'خلاصهٔ تسک در حال آماده‌شدن است.');
    return `<article class="mt-row mtr-card${done ? ' is-done' : ''}" ><button type="button" class="mtr-card-open" data-action="mt-row:${encodeURIComponent(item.key)}" aria-label="${e(item.id + ': ' + item.title)}"><span class="mtr-card-top"><b dir="auto">${done ? '<span aria-hidden="true">✓ </span>' : ''}${e(item.title)}</b><span class="mt-state pill ${done ? 'green' : item.state_category === 'inprogress' ? 'amber' : 'blue'}">${e(cardStateLabel(item))}</span></span><span class="mtr-brief" dir="auto">${e(brief.slice(0, 220))}</span><span class="mtr-card-meta"><span class="pill blue">${e(sourceLabel(item))}</span><span>${e(item.source === 'jira' ? item.id : `#${item.id}`)}</span><span dir="auto">${e(item.project)}</span>${item.area_path ? `<span class="mtr-area" dir="auto" title="${e(item.area_path)}">${e(item.area_path.split('\\').slice(1).join(' / ') || item.area_path)}</span>` : ''}<span class="pill ${priorityTone(item)}" title="${e(t('Source priority', '\u0627\u0648\u0644\u0648\u06cc\u062a \u0645\u0646\u0628\u0639'))}">${e(priorityLabel(item))}</span>${item.iteration_path ? `<span dir="auto" title="${e(item.iteration_path)}">${e(item.iteration_path.split('\\').at(-1))}</span>` : ''}${item.source !== 'jira' ? `<span class="pill ${prepTone(item.prep_status)}">${e(prepLabel(prepStatusOf(item)))}</span>` : ''}${item.review_status === 'ready' ? `<span class="pill green">${e(t('Reviewed', '\u0645\u0631\u0648\u0631\u0634\u062f\u0647'))}</span>` : ''}${['stale', 'failed'].includes(item.review_status) ? `<span class="mtr-review-status">${e(item.review_status === 'stale' ? t('Review updating', 'به‌روزرسانی مرور') : t('Review needs attention', 'مرور نیاز به رسیدگی دارد'))}</span>` : ''}</span></button>${!done ? `<button type="button" class="mtr-urgency ${e(item.triage?.level || 'unknown')}" data-mtr-action="urgency:${encodeURIComponent(item.key)}">${e(urgencyLabel(item))}${item.triage?.stale ? t(' (updating)', ' (\u062f\u0631 \u062d\u0627\u0644 \u0628\u0647\u200c\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc)') : ''}</button>` : ''}</article>`;
  }
  function render(data = {}, settings = {}, status = {}, options) {
    context = options;
    latest = [data, settings, status, options];
    const key = `atl-my-tasks-view:${data.workspace_key || 'loading'}`;
    if (preferenceKey !== key) {
      preferenceKey = key;
      try { preferences = JSON.parse(localStorage.getItem(key) || 'null'); } catch { preferences = null; }
      preferences = { view: 'list', query: '', project: '', area: '', type: '', state: '', source: '', priority: '', urgency: '', sort: 'urgency', open: { proposed: true, inprogress: true, complete: false }, limits: {}, ...preferences };
      for (const name of ['query', 'project', 'area', 'type', 'state', 'prep']) if (typeof preferences[name] !== 'string') preferences[name] = '';
      if (!['list', 'kanban'].includes(preferences.view)) preferences.view = 'list';
      preferences.open = { proposed: true, inprogress: true, complete: false, ...(preferences.open || {}) };
      preferences.limits = preferences.limits && typeof preferences.limits === 'object' ? preferences.limits : {};
    }
    const all = data.items || [], query = preferences.query.toLowerCase();
    let visible = all.filter(item => (!query || `${item.id} ${item.title} ${item.brief || ''} ${item.description_text || ''}`.toLowerCase().includes(query)) && ['project', 'area', 'type', 'state'].every(filter => !preferences[filter] || (filter === 'area' ? item.area_path : item[filter]) === preferences[filter]));
    visible = visible.filter(item => (!preferences.source || (item.source || 'azure') === preferences.source) && (!preferences.priority || priorityKey(item) === preferences.priority) && (!preferences.urgency || (item.triage?.level || 'unknown') === preferences.urgency) && (!preferences.prep || (item.source !== 'jira' && prepStatusOf(item) === preferences.prep)));
    visible.sort((a, b) => {
      if (preferences.sort === 'urgency' && a.state_category !== 'complete' && b.state_category !== 'complete') {
        const score = item => item.triage?.status === 'ready' && !item.triage?.stale && item.triage?.score != null ? item.triage.score : -1;
        const delta = score(b) - score(a); if (delta) return delta;
      }
      if (preferences.sort !== 'updated') { const delta = (a.source_priority?.rank ?? a.priority ?? 999) - (b.source_priority?.rank ?? b.priority ?? 999); if (delta) return delta; }
      return String(b.changed_at || '').localeCompare(String(a.changed_at || ''));
    });
    const filter = (name, label, values) => `<label class="mtr-filter"><span class="sr-only">${e(label)}</span><select class="input" data-mtr-filter="${name}" aria-label="${e(label)}"><option value="">${e(label)}</option>${[...new Set(values.filter(Boolean))].sort().map(value => `<option value="${e(value)}" ${preferences[name] === value ? 'selected' : ''}>${e(value)}</option>`).join('')}</select></label>`;
    const progress = data.reviews || {};
    const loadingHtml = `<section class="panel pad" role="status"><span class="running-mark" aria-hidden="true"></span><span class="muted">${e(t('Loading assigned tasks…', 'در حال دریافت تسک‌ها…'))}</span></section>`;
    const groups = ['proposed', 'inprogress', 'complete'].map(state => {
      const items = visible.filter(item => item.state_category === state), total = all.filter(item => item.state_category === state).length;
      const limit = preferences.limits[state] || initialLimit();
      return `<details class="mtr-status-group ${state === 'complete' ? 'mtr-done-group' : ''}" data-mtr-group="${state}" ${(preferences.view === 'kanban' || preferences.open[state]) ? 'open' : ''}><summary><span class="mtr-status-dot ${state}"></span><h2>${e(stateLabel(state))}</h2><span class="mtr-count">${items.length}${items.length !== total ? ` / ${total}` : ''}</span></summary><div class="mtr-cards">${items.slice(0, limit).map(card).join('') || `<p class="mtr-group-empty">${e(t('No tasks in this section.', 'تسکی در این بخش نیست.'))}</p>`}${items.length > limit ? ownButton(t(`Show ${Math.min(30, items.length - limit)} more`, `${Math.min(30, items.length - limit)} مورد بیشتر`), `more:${state}`, 'ghost') : ''}</div></details>`;
    }).join('');
    return `<div class="mtr-root" data-no-translate><div class="mtr-pagehead"><div><h1>${e(t('My Tasks', 'تسک‌های من'))}</h1><p class="sub">${e(t('Know the request. See the next step.', 'خواسته را بفهم؛ قدم بعدی را ببین.'))}</p></div><div class="bar"><button class="btn" data-action="mt-check">${e(t('Check now', 'بررسی اکنون'))}</button><button class="btn primary" data-action="mt-settings">${e(t('Settings', 'تنظیمات'))}</button></div></div>${options.error ? `<p class="notice" role="alert">${e(options.error)}</p>` : ''}${options.notice ? `<p role="status" class="sub">${e(options.notice)}</p>` : ''}${status.paused ? `<div class="notice" role="alert"><b>${e(t('My Tasks checks are paused: the Azure credential was rejected.', 'بررسی تسک‌های من متوقف شد: اعتبار آژور رد شد.'))}</b><span class="sub">${e(t('Re-authenticate with a PAT that has Work Items: Read access, then run Check now.', 'با PAT دارای دسترسی Work Items: Read دوباره احراز هویت کنید، سپس «بررسی اکنون» را بزنید.'))}</span><div class="bar">${options.connection?.id ? `<button class="btn primary" data-action="mt-reconnect:${options.connection.id}">${e(t('Re-authenticate', 'احراز هویت دوباره'))}</button>` : `<button class="btn primary" data-action="go:sources">${e(t('Open Issue sources', 'باز کردن منابع مسئله'))}</button>`}<button class="btn" data-action="mt-check">${e(t('Check now', 'بررسی اکنون'))}</button></div></div>` : ''}<div class="mtr-toolbar"><label class="mtr-search"><span class="sr-only">${e(t('Search work items', 'جست‌وجوی تسک‌ها'))}</span><input class="input" id="mtrSearch" placeholder="${e(t('Search tasks…', 'جست‌وجوی تسک‌ها…'))}" value="${e(preferences.query)}"></label><div class="mtr-view" role="group" aria-label="${e(t('Task view', 'نمای تسک‌ها'))}">${['list', 'kanban'].map(view => `<button class="btn ${preferences.view === view ? 'primary' : 'ghost'}" aria-pressed="${preferences.view === view}" data-mtr-action="view:${view}">${e(view === 'list' ? t('List', 'لیست') : t('Kanban', 'کانبان'))}</button>`).join('')}</div><div class="mtr-filters">${filter('project', t('All projects', 'همهٔ پروژه‌ها'), all.map(i => i.project))}${filter('area', t('All areas', 'همهٔ بخش‌ها'), all.map(i => i.area_path))}${filter('type', t('All types', 'همهٔ نوع‌ها'), all.map(i => i.type))}${filter('state', t('All states', 'همهٔ وضعیت‌ها'), all.map(i => i.state))}</div></div>${advancedFilters(all)}<div class="mtr-progress" role="status" aria-live="polite"><span>${e(t(`${progress.ready || 0} of ${progress.total ?? all.length} reviews ready`, `${progress.ready || 0} از ${progress.total ?? all.length} مرور آماده`))}</span>${progress.running ? `<span class="muted tiny">${e(t('Reviewing in the background…', 'مرور در پس‌زمینه…'))}</span>` : ''}${progress.paused ? `<span class="amber">${e(t('Review provider needs attention in Settings.', 'ارائه‌دهندهٔ مرور در تنظیمات نیاز به رسیدگی دارد.'))}</span>${ownButton(t('Resume reviews', 'ادامهٔ مرورها'), 'resume', 'sm')}` : ''}</div>${options.loading ? loadingHtml : !options.connected && !data.jira?.enabled ? `<div class="notice"><b>${e(t('Connect Azure Boards to see your tasks.', 'برای دیدن تسک‌ها به Azure Boards متصل شوید.'))}</b>${options.connection?.id ? `<button class="btn primary" data-action="mt-reconnect:${options.connection.id}">${e(t('Re-authenticate', 'احراز هویت دوباره'))}</button>` : ''}<button class="btn" data-action="go:sources">${e(t('Issue sources', 'منابع مسئله'))}</button></div>` : !all.length ? `<section class="panel mtr-empty"><h2>${e(t('No assigned work items yet', 'هنوز تسکی تخصیص نیافته است'))}</h2><p class="sub">${e(t('Check now to refresh your assigned tasks.', 'برای دریافت تسک‌های تخصیص‌یافته، بررسی اکنون را بزنید.'))}</p></section>` : `<div class="mtr-board ${preferences.view === 'kanban' ? 'is-kanban' : 'is-list'}">${groups}</div>`}<div class="mtr-tools">${ownButton(t('Analysis & Jira settings', '\u062a\u0646\u0638\u06cc\u0645\u0627\u062a \u062a\u062d\u0644\u06cc\u0644 \u0648 Jira'), 'analysis-settings', 'sm ghost')}</div><details class="mtr-sync"><summary>${e(t('Sync status', 'وضعیت همگام‌سازی'))}</summary><div class="mtr-sync-content">${data.jira?.enabled ? `<span dir="auto">Jira: ${e(data.jira.site?.name || '')} · ${e(data.jira.status)}</span>` : ''}<span>${e(options.connected ? t('Azure connected', 'آژور متصل است') : t('Not connected', 'متصل نیست'))}</span><span>${e(t(`Every ${settings.interval_minutes || 15} minutes`, `هر ${settings.interval_minutes || 15} دقیقه`))}</span><span>${e(status.last_run?.finished_at ? new Date(status.last_run.finished_at).toLocaleString(context.locale) : t('First check pending', 'در انتظار اولین بررسی'))}</span>${status.paused ? `<span class="amber">${e(t('Renew the Azure connection.', 'اتصال آژور را تمدید کنید.'))}</span>` : ''}${Object.entries(data.projects || {}).filter(([, p]) => p.status !== 'fresh').map(([name, p]) => `<span class="amber" dir="auto">${e(name)}: ${e(p.status)}</span>`).join('')}</div></details></div>`;
  }
  function pending(review) {
    return `<div class="mtr-pending" role="status"><h3>${review.error ? '' : '<span class="running-mark" aria-hidden="true"></span>'}${e(t('ATL is preparing this review', 'آتل در حال آماده‌کردن این مرور است'))}</h3><p>${e(review.error ? t('Review could not finish. Check the provider or retry.', 'مرور کامل نشد. ارائه‌دهنده را بررسی کنید یا دوباره تلاش کنید.') : t('This task is queued. You can read the original request now.', 'این تسک در صف است؛ متن اصلی همین حالا قابل مشاهده است.'))}</p>${review.error ? ownButton(t('Retry review', 'تلاش دوباره'), 'retry') : ''}</div>`;
  }
  // ---------- Spec 022: preparation tab ----------
  function prepDraftOf(record) {
    if (!opened.prepDraft) opened.prepDraft = {
      outcome: record?.brief?.outcome || '', existing_behavior: record?.brief?.existing_behavior || '',
      requested_behavior: record?.brief?.requested_behavior || '', scope: record?.brief?.scope || '',
      acceptance_examples: (record?.brief?.acceptance_examples || []).join('\n'), next_action: record?.next_action || '',
    };
    return opened.prepDraft;
  }
  function syncPrepDraft() {
    const draft = opened?.prepDraft;
    if (!draft) return;
    for (const [id, field] of [['prepOutcome', 'outcome'], ['prepExisting', 'existing_behavior'], ['prepRequested', 'requested_behavior'], ['prepScope', 'scope'], ['prepExamples', 'acceptance_examples'], ['prepNext', 'next_action']]) {
      const node = document.getElementById(id);
      if (node) draft[field] = node.value;
    }
  }
  const prepField = (id, label, value, rows) => `<label class="label" for="${id}">${e(label)}</label><textarea id="${id}" class="input" rows="${rows}" dir="auto">${e(value)}</textarea>`;
  function prepQuestionCard(question) {
    const open = !question.answer;
    return `<div class="mtr-prep-question"><span class="pill ${question.kind === 'owner_decision' ? 'amber' : 'blue'}">${e(question.kind === 'owner_decision' ? t('Owner decision', 'تصمیم مالک') : t('Investigation', 'بررسی'))}</span> <b dir="auto">${e(question.question)}</b>${question.why ? `<p class="sub" dir="auto">${e(t('Why it matters', 'چرا مهم است'))}: ${e(question.why)}</p>` : ''}${question.from_run ? `<p class="muted tiny">${e(t('Raised by discovery run', 'از اجرای کشف'))} <code>${e(question.from_run)}</code></p>` : ''}${open ? `<div class="mtr-tools">${(question.options || []).map(option => `<button type="button" class="btn sm" data-mtr-action="prep-answer:${e(question.id)}" data-prep-option="${e(option)}">${e(option)}</button>`).join('')}</div><div class="bar"><label class="sr-only" for="prepAnswer-${e(question.id)}">${e(t('Answer', 'پاسخ'))}</label><input id="prepAnswer-${e(question.id)}" class="input" dir="auto" placeholder="${e(t('Write an answer…', 'پاسخی بنویسید…'))}">${ownButton(t('Save answer', 'ذخیرهٔ پاسخ'), `prep-answer:${e(question.id)}`, 'sm primary')}</div>` : `<p class="mtr-preserve" dir="auto"><b>${e(t('Answer', 'پاسخ'))}:</b> ${e(question.answer)}</p>`}</div>`;
  }
  function prepRunCard(run) {
    return `<div class="mtr-prep-run"><b>${run.kind === 'manual' ? e(t('Manual notes', 'یادداشت دستی')) : e(t('Discovery', 'کشف'))}</b>${run.kind !== 'manual' ? ` <span class="muted tiny">${e(run.provider || '')} ${e(run.model || '')}</span>` : ''} <span class="muted tiny">${e(new Date(run.at).toLocaleString(context.locale))}</span>${run.current === false ? ` <span class="amber tiny">${e(t('ran against an earlier brief', 'نسبت به نسخهٔ قبلی خلاصه'))}</span>` : ''}${run.error ? `<p class="amber" dir="auto">${e(run.error)}</p>` : ''}${run.notes ? `<pre class="mtr-preserve" dir="auto">${e(run.notes)}</pre>` : ''}${(run.findings || []).length ? `<ul class="mtr-findings">${run.findings.map(finding => `<li dir="auto">${e(finding)}</li>`).join('')}</ul>` : ''}${(run.code_locations || []).length ? `<details><summary>${e(t(`Code locations (${run.code_locations.length})`, `موقعیت‌های کد (${run.code_locations.length})`))}</summary><ul>${run.code_locations.map(location => `<li dir="ltr"><code>${e(location.path)}${location.line ? ':' + location.line : ''}</code>${location.note ? ` — <span dir="auto">${e(location.note)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}</div>`;
  }
  function prepBody() {
    const prep = opened.prep;
    if (!prep) return `<p class="sub" role="status">${e(t('Preparation loads when you open this tab.', 'آماده‌سازی با بازکردن این برگه بارگذاری می‌شود.'))}</p>`;
    if (prep.loading) return `<p class="sub" role="status"><span class="running-mark" aria-hidden="true"></span>${e(t('Loading preparation…', 'در حال بارگذاری آماده‌سازی…'))}</p>`;
    if (prep.error) return `<p class="notice" role="alert">${e(prep.error)}</p><div class="mtr-tools">${ownButton(t('Try again', 'تلاش دوباره'), 'prep-load', 'sm')}</div>`;
    const record = prep.record, draft = prepDraftOf(record);
    const status = `<span class="pill ${prepTone(prep.status)}">${e(prepLabel(prep.status))}</span>`;
    const freshness = prep.freshness && !prep.freshness.fresh ? `<p class="notice amber" role="alert">${e(t(`The Azure task changed since preparation (revision ${prep.freshness.prepared ?? '?'} → ${prep.freshness.current ?? '?'}). Refresh the brief and hand off again before planning.`, `تسک آژور پس از آماده‌سازی تغییر کرده است (نسخهٔ ${prep.freshness.prepared ?? '?'} → ${prep.freshness.current ?? '?'}). خلاصه را به‌روز کنید و دوباره تحویل دهید.`))}</p>` : '';
    const limitation = record?.brief?.evidence_limitation ? `<p class="amber tiny" dir="auto">${e(record.brief.evidence_limitation)}</p>` : '';
    const questions = record?.questions || [];
    const openQuestions = questions.filter(question => !question.answer);
    const answered = questions.filter(question => question.answer);
    const linked = prep.linked_request;
    const runs = prep.runs_current || [];
    return `<div class="mtr-prep"><p id="mtrPrepError" role="status"></p>${freshness}<p class="mtr-prep-status">${status} <span class="sub" dir="auto">${e(prep.next_action)}</span></p><h3>${e(t('Brief', 'خلاصه'))}</h3>${limitation}${prepField('prepOutcome', t('Understood outcome', 'نتیجهٔ فهمیده‌شده'), draft.outcome, 2)}${prepField('prepExisting', t('Existing behavior', 'رفتار موجود'), draft.existing_behavior, 2)}${prepField('prepRequested', t('Requested behavior', 'رفتار درخواستی'), draft.requested_behavior, 2)}${prepField('prepScope', t('Scope', 'محدوده'), draft.scope, 2)}${prepField('prepExamples', t('Acceptance examples (one per line)', 'نمونه‌های پذیرش (هر خط یک مورد)'), draft.acceptance_examples, 3)}${prepField('prepNext', t('Next action', 'قدم بعدی'), draft.next_action, 2)}<div class="mtr-tools">${ownButton(t('Save brief', 'ذخیرهٔ خلاصه'), 'prep-save', 'primary sm')}</div>${openQuestions.length ? `<h3>${e(t(`Questions (${openQuestions.length} open)`, `پرسش‌ها (${openQuestions.length} باز)`))}</h3><p class="muted tiny">${e(t('Owner decisions and investigation questions stay separate; planning unlocks only when both are settled.', 'تصمیم‌های مالک و پرسش‌های بررسی جدا می‌مانند؛ برنامه‌ریزی فقط وقتی باز می‌شود که هر دو حل شده باشند.'))}</p>${openQuestions.map(prepQuestionCard).join('')}` : ''}${answered.length ? `<details><summary>${e(t(`Answered (${answered.length})`, `پاسخ‌داده‌شده (${answered.length})`))}</summary>${answered.map(prepQuestionCard).join('')}</details>` : ''}<details class="mtr-prep-add"><summary>${e(t('Add a question', 'افزودن پرسش'))}</summary><label class="label" for="prepQKind">${e(t('Kind', 'نوع'))}</label><select id="prepQKind" class="input"><option value="owner_decision">${e(t('Owner decision — only the requester can answer', 'تصمیم مالک — فقط درخواست‌دهنده پاسخ می‌دهد'))}</option><option value="investigation">${e(t('Investigation — answerable from code or the team', 'بررسی — از کد یا تیم قابل پاسخ است'))}</option></select><label class="label" for="prepQText">${e(t('Question', 'پرسش'))}</label><textarea id="prepQText" class="input" rows="2" dir="auto"></textarea><label class="label" for="prepQWhy">${e(t('Why it matters (optional)', 'چرا مهم است (اختیاری)'))}</label><input id="prepQWhy" class="input" dir="auto">${ownButton(t('Add question', 'افزودن پرسش'), 'prep-question', 'sm')}</details>${runs.length ? `<h3>${e(t('Investigation', 'بررسی'))}</h3>${runs.map(prepRunCard).join('')}` : ''}<details class="mtr-prep-add"><summary>${e(t('Record manual investigation', 'ثبت بررسی دستی'))}</summary><textarea id="prepManual" class="input" rows="3" dir="auto" placeholder="${e(t('What you checked and what you found…', 'چه چیزی را بررسی کردید و چه یافتید…'))}"></textarea>${ownButton(t('Save notes', 'ذخیرهٔ یادداشت'), 'prep-notes', 'sm')}</details><div class="mtr-tools">${ownButton(t('Run bounded discovery', 'اجرای کشف محدود'), 'prep-discover', 'sm')}${ownButton(record ? t('Hand off to Plan Studio', 'تحویل به استودیو برنامه‌ریزی') : t('Hand off to Plan Studio', 'تحویل به استودیو برنامه‌ریزی'), 'prep-handoff', 'sm ghost')}</div>${opened.prepBusy ? `<p class="sub" role="status">${e(t('Bounded discovery is running (up to 3 minutes). The brief stays readable meanwhile.', 'کشف محدود در حال اجراست (حداکثر ۳ دقیقه). خلاصه در این مدت خوانا می‌ماند.'))}</p>` : ''}<p class="muted tiny">${e(t('Discovery sends one bounded provider request with the brief and linked repositories. Preparation states never replace the plan review and approval gates.', 'کشف یک درخواست محدود به ارائه‌دهنده با خلاصه و مخزن‌های متصل می‌فرستد. وضعیت‌های آماده‌سازی جایگزین مرور و تأیید برنامه نیستند.'))}</p>${linked ? `<h3>${e(t('Plan Studio request', 'درخواست استودیو برنامه‌ریزی'))}</h3><p class="sub"><code>${e(linked.task_id)}</code>${linked.archived ? ` <span class="pill">${e(t('archived', 'بایگانی‌شده'))}</span>` : ''} · ${linked.plans.length ? e(t(`${linked.plans.length} plan draft(s)`, `${linked.plans.length} پیش‌نویس برنامه`)) : e(t('no plan yet', 'هنوز برنامه‌ای نیست'))}${linked.plan_review_required ? ` · <span class="amber">${e(t('plan review pending', 'مرور برنامه در انتظار'))}</span>` : ''}</p>` : ''}</div>`;
  }
  async function loadPrep(item) {
    const id = generation;
    opened.prep = { loading: true };
    opened.prepDraft = null;
    showDetail();
    try {
      const data = await api(`/api/my-tasks/preparation?key=${encodeURIComponent(item.key)}`);
      if (id !== generation || !document.querySelector('.mtr-detail')) return;
      opened.prep = data;
      showDetail();
    } catch (error) {
      if (id !== generation || !document.querySelector('.mtr-detail')) return;
      opened.prep = { error: error.message };
      showDetail();
    }
  }
  async function openInStudio(taskId, repoId) {
    // The plan: controller only navigates once the snapshot contains the
    // freshly handed-off request; retry across snapshot refreshes instead of
    // silently doing nothing on a race.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await Promise.resolve(context.refresh?.());
      const button = document.createElement('button');
      button.type = 'button';
      button.hidden = true;
      button.dataset.action = `plan:${taskId}${repoId ? `:${repoId}` : ''}`;
      document.body.append(button);
      button.click();
      button.remove();
      if (!document.querySelector('.mtr-detail-dialog') && document.getElementById('goal')) return;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  function detailBody() {
    const { item, review, tab } = opened, result = review.result;
    let body = '';
    if (tab === 'prep') body = prepBody();
    else if (tab === 'original') {
      const meta = [[t('Type', 'نوع'), item.type], [t('State', 'وضعیت'), item.state], [t('Priority', 'اولویت'), priorityLabel(item)], [t('Area', 'بخش'), item.area_path], [t('Sprint', 'اسپرینت'), item.iteration_path], [t('Assignee', 'مسئول'), item.assignee_name], [t('Revision', 'نسخه'), item.rev], [t('Last change', 'آخرین تغییر'), item.changed_at ? new Date(item.changed_at).toLocaleString(context.locale) : '—']];
      body = `<h3>${e(t('Description', 'توضیحات'))}</h3><div class="mt-desc" dir="auto">${item.description_html || `<p>${e(t('No description was provided.', 'توضیحی ارائه نشده است.'))}</p>`}</div><h3>${e(t('Acceptance criteria', 'معیارهای پذیرش'))}</h3><p class="mtr-preserve" dir="auto">${e(item.acceptance_criteria || t('Not specified.', 'مشخص نشده است.'))}</p><details><summary>${e(t('Task information', 'اطلاعات تسک'))}</summary><dl class="mtr-metadata">${meta.map(([key, value]) => `<div><dt>${e(key)}</dt><dd dir="auto">${e(value ?? '—')}</dd></div>`).join('')}</dl><p dir="auto">${e((item.tags || []).join(' · '))}</p></details>`;
    } else if (!result) body = pending(review);
    else if (tab === 'overview') body = `<p class="mtr-summary" dir="auto">${e(result.summary)}</p><div class="mtr-outcome"><h3>${e(t('Expected outcome', 'نتیجهٔ مورد انتظار'))}</h3><p dir="auto">${e(result.expected)}</p></div>${result.next_step ? `<div class="mtr-next-action"><h3>${e(t('Next step', '\u0642\u062f\u0645 \u0628\u0639\u062f\u06cc'))}</h3><p dir="auto">${e(result.next_step)}</p></div>` : ''}${result.ambiguity ? `<p class="mtr-ambiguity" dir="auto">${e(result.ambiguity)}</p>` : ''}<div class="mtr-diagram" aria-busy="true"><div class="mtr-flow" role="img" aria-label="${e(t('Current situation, proposed change and expected result', 'وضع موجود، تغییر پیشنهادی و نتیجه'))}">${result.diagram.nodes.map(n => `<div class="mtr-flow-node ${e(n.kind)}"><span class="muted tiny">${e(({ observed: t('Observed', 'مشاهده‌شده'), proposed: t('Proposed', 'پیشنهادی'), unknown: t('Unknown', 'نامشخص') })[n.kind])}</span><b dir="auto">${e(n.label)}</b></div>`).join('')}${flowLinks(result.diagram)}</div><div class="mtr-diagram-render" hidden></div></div><div class="mtr-diagram-actions">${ownButton(t('Enlarge diagram', 'بزرگ‌کردن نمودار'), 'zoom', 'sm ghost')}<details><summary>${e(t('Mermaid source', 'کد Mermaid'))}</summary><pre dir="ltr">${e(review.mermaid)}</pre></details></div>`;
    else body = `<h3>${e(t('Request review', 'مرور درخواست'))}</h3><ul class="mtr-findings">${result.findings.map(f => `<li dir="auto">${e(f.text)}</li>`).join('') || `<li>${e(t('No additional findings in this review.', 'نکتهٔ تکمیلی در این مرور ثبت نشده است.'))}</li>`}</ul><h3>${e(t('Suggested checks', 'بررسی‌های پیشنهادی'))}</h3><ul>${result.checks.map(c => `<li dir="auto">${e(c)}</li>`).join('')}</ul><p class="muted tiny">${e(t('Suggested checks have not been executed. Completion status is not code verification.', 'این بررسی‌ها اجرا نشده‌اند. وضعیت انجام‌شده، تأیید کد نیست.'))}</p><details class="mtr-evidence"><summary>${e(t(`Code evidence (${review.evidence?.length || 0})`, `شواهد کد (${review.evidence?.length || 0})`))}</summary>${(review.repositories || []).map(repo => `<section><h4 dir="auto">${e(repo.name)}</h4>${repo.error ? `<p>${e(t('Repository is unavailable.', 'مخزن در دسترس نیست.'))}</p>` : ''}${(review.evidence || []).filter(ev => ev.repository_id === repo.id).map(ev => `<details><summary><code dir="ltr">${e(ev.path)}:${ev.line}–${ev.end_line}</code></summary><pre dir="ltr">${e(ev.excerpt)}</pre></details>`).join('')}</section>`).join('') || `<p>${e(t('No repository has been connected.', 'مخزنی متصل نشده است.'))}</p>`}</details><details><summary>${e(t('Review provenance', 'مشخصات تولید مرور'))}</summary><p>${e(review.provider || 'ATL')} ${e(review.model || '')}</p><p dir="ltr">${e(review.fingerprint)}</p>${(review.skills || []).map(s => `<p><code>${e(s.name)} ${e(s.version.slice(0, 12))}</code></p>`).join('')}</details>${ownButton(t('Repository override', 'اتصال اختصاصی مخزن'), 'item-binding', 'sm')}${ownButton(t('Regenerate review', 'بازتولید مرور'), 'retry', 'sm ghost')}`;
    if (tab === 'review' && !result) body += ownButton(t('Repository override', 'اتصال اختصاصی مخزن'), 'item-binding', 'sm');
    const stale = review.status !== 'ready' && result;
    return `<div class="mtr-detail" data-no-translate><div class="mtr-detail-caption"><span dir="auto">${e(sourceLabel(item))} · ${e(item.project)} · #${e(item.id)}${item.iteration_path ? ` · ${e(item.iteration_path.split('\\').at(-1))}` : ''}</span><span>${e(item.state)}</span></div><div class="mtr-tabs" role="tablist" aria-label="${e(t('Task details', 'جزئیات تسک'))}">${[['overview', t('At a glance', 'نگاه سریع')], ['review', t('Request review', 'مرور درخواست')], ['original', t('Original task', 'اصل تسک')], ...(opened.item.source !== 'jira' ? [['prep', t('Preparation', 'آماده‌سازی')]] : [])].map(([id, label]) => `<button role="tab" id="mtr-tab-${id}" aria-controls="mtr-tabpanel" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}" data-mtr-action="tab:${id}">${e(label)}</button>`).join('')}</div><div class="mtr-detail-provenance"><span>${e(result ? t('Generated by ATL', 'تولیدشده توسط آتل') : t('ATL review pending', 'مرور آتل در انتظار است'))}</span>${result ? `<span>${e([review.provider, review.model].filter(Boolean).join(' / '))}</span><span>${e(new Date(review.generated_at).toLocaleString(context.locale))}</span><span>${e(review.coverage === 'code' ? t('Code evidence included', 'همراه شواهد کد') : t('Code not reviewed', 'کد بررسی نشده'))}</span>` : ''}${stale ? `<strong class="amber">${e(t('Needs updating', 'نیازمند به‌روزرسانی'))}</strong>` : ''}</div>${!result && review.previous?.length ? `<p>${e(t('A version in another language is available.', 'نسخه‌ای به زبان دیگر موجود است.'))} ${review.previous.map(p => ownButton(p.locale, `previous:${p.locale}`, 'sm ghost')).join('')}</p>` : ''}<div id="mtr-tabpanel" role="tabpanel" aria-labelledby="mtr-tab-${tab}" tabindex="0" class="mtr-tabpanel">${body}</div></div>`;
  }
  function showDetail() {
    context.popupWide(`#${e(opened.item.id)} · ${e(opened.item.title)}`, detailBody(), `<a class="btn primary" href="${e(opened.item.url)}" target="_blank" rel="noopener noreferrer">${e(t(opened.item.source === 'jira' ? 'Open in Jira' : 'Open in Azure', opened.item.source === 'jira' ? 'بازکردن در Jira' : 'بازکردن در آژور'))}</a>${context.btn(t('Close', 'بستن'), 'close', 'ghost')}`, 'mtr-detail-dialog');
    if (opened.tab === 'overview' && opened.review.result) void draw();
  }
  async function open(item) {
    const id = ++generation;
    opened = { item, tab: 'overview', review: { status: 'loading' } };
    showDetail();
    try {
      const data = await api(`/api/my-tasks/review?key=${encodeURIComponent(item.key)}&locale=${context.locale}`);
      if (id !== generation || !document.querySelector('.mtr-detail')) return;
      opened.review = data.review; showDetail();
      pollDetail(id);
    } catch { if (id === generation && document.querySelector('.mtr-detail')) { opened.review = { status: 'failed', error: true }; showDetail(); } }
  }
  function pollDetail(id) {
    if (!opened || opened.review.status === 'ready' || opened.review.status === 'failed') return;
    setTimeout(async () => {
      if (id !== generation || !document.querySelector('.mtr-detail')) return;
      try {
        const data = await api(`/api/my-tasks/review?key=${encodeURIComponent(opened.item.key)}&locale=${context.locale}`);
        if (id !== generation || !document.querySelector('.mtr-detail')) return;
        if (data.review.status !== opened.review.status || data.review.generated_at !== opened.review.generated_at) {
          const focused = document.activeElement?.id;
          opened.review = data.review;
          document.querySelector('.mtr-detail').outerHTML = detailBody();
          if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
          if (opened.tab === 'overview' && opened.review.result) void draw();
        }
        pollDetail(id);
      } catch { pollDetail(id); }
    }, 3500);
  }
  async function draw() {
    const id = generation, source = opened.review.mermaid;
    const holder = document.querySelector('.mtr-diagram');
    if (!holder) return;
    try {
      if (!window.mermaid) {
        mermaidPromise ||= new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/assets/mermaid.min.js'; script.onload = resolve; script.onerror = () => { mermaidPromise = null; reject(new Error('Diagram asset unavailable')); }; document.head.append(script); });
        await mermaidPromise;
      }
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, look: 'classic', theme: document.documentElement.classList.contains('light') ? 'default' : 'dark', flowchart: { htmlLabels: false, useMaxWidth: true }, fontFamily: getComputedStyle(document.body).fontFamily, themeVariables: { fontSize: '14px' }, themeCSS: '.label{font-size:14px!important;margin:0!important}.nodeLabel{font-size:14px!important}' });
      const tokens = getComputedStyle(document.documentElement);
      const themed = source.replace('flowchart TB', holder.clientWidth > 600 && opened.review.result.diagram.nodes.length <= 5 ? 'flowchart LR' : 'flowchart TB').replace(/classDef (observed|proposed|unknown)[^\n]*/g, (_, kind) => `classDef ${kind} fill:${tokens.getPropertyValue('--pane').trim()},stroke:${tokens.getPropertyValue(kind === 'observed' ? '--accent' : kind === 'proposed' ? '--blue' : '--amber').trim()},color:${tokens.getPropertyValue('--text').trim()}${kind === 'unknown' ? ',stroke-dasharray:5 4' : ''}`);
      const { svg } = await window.mermaid.render(`mtr-svg-${id}-${Date.now()}`, themed);
      if (generation !== id || !holder.isConnected) return;
      const target = holder.querySelector('.mtr-diagram-render'); target.innerHTML = svg; target.hidden = false;
      target.querySelector('svg')?.setAttribute('aria-label', t('Task change flow', 'جریان تغییر تسک'));
      holder.querySelector('.mtr-flow').hidden = true;
    } catch { /* The accessible text flow is already visible. */ }
    finally { holder.setAttribute('aria-busy', 'false'); }
  }
  async function bindings(item = null) {
    const data = await api('/api/my-tasks/repository-bindings');
    const candidates = [...(latest?.[0].items || []), ...(latest?.[1].projects || []).map(project => ({ project, connection: String(context.connection?.org_url || '').replace(/\/$/, '').toLowerCase() })), ...data.bindings.rules];
    const projects = [...new Map(candidates.filter(p => p.connection && p.project).map(p => [JSON.stringify([p.connection, p.project]), { project: p.project, connection: p.connection }])).values()];
    const selected = item ? data.bindings.items[item.key] || [] : [];
    const repositories = data.repositories.map(repo => `<label class="mt-projectrow"><input type="checkbox" data-mtr-repo="${e(repo.id)}" ${selected.includes(repo.id) ? 'checked' : ''}>${e(repo.name)}</label>`).join('');
    context.popupWide(t('Repository connections', 'اتصال مخزن‌ها'), `<div class="mtr-bindings" data-no-translate><p class="sub">${e(item ? t('This override takes precedence over project and area rules. Clear it to inherit connections.', 'این اتصال بر قوانین پروژه و بخش اولویت دارد. برای استفاده از قوانین، اتصال اختصاصی را پاک کنید.') : t('Connect a project or area to registered ATL repositories. Exact imported-task connections take precedence.', 'پروژه یا بخش را به مخزن‌های ثبت‌شده وصل کنید. اتصال دقیق درخواست importشده اولویت دارد.'))}</p>${item ? `<p dir="auto">#${e(item.id)} ${e(item.title)}</p>` : `<label class="label" for="mtrBindingProject">${e(t('Project / source', 'پروژه / منبع'))}</label><select class="input" id="mtrBindingProject">${projects.map(p => `<option value="${e(p.project)}" data-connection="${e(p.connection)}">${e(p.project)} / ${p.connection.startsWith('jira:') ? 'Jira' : 'Azure'}</option>`).join('')}</select><label class="label" for="mtrBindingArea">${e(t('Area Path (optional)', 'مسیر بخش (اختیاری)'))}</label><input class="input" id="mtrBindingArea" placeholder="Project\\Area">`}<fieldset><legend>${e(t('Registered repositories', 'مخزن‌های ثبت‌شده'))}</legend>${repositories || `<p>${e(t('Register a repository from Projects first.', 'ابتدا از صفحهٔ پروژه‌ها یک مخزن ثبت کنید.'))}</p>`}</fieldset><p role="alert" id="mtrBindingError"></p>${!item ? `<h3>${e(t('Saved rules', 'قوانین ذخیره‌شده'))}</h3>${data.bindings.rules.map((rule, index) => `<div class="mtr-binding-rule"><span dir="auto">${e(rule.project)} ${e(rule.area)} → ${e(rule.repository_ids.map(id => data.repositories.find(r => r.id === id)?.name || id).join(', '))}</span>${ownButton(t('Edit', 'ویرایش'), `binding-edit:${index}`, 'sm ghost')}${ownButton(t('Remove', 'حذف'), `binding-remove:${index}`, 'sm ghost')}</div>`).join('')}` : ''}</div>`, ownButton(t('Save connections', 'ذخیرهٔ اتصال‌ها'), 'binding-save', 'primary') + (item ? ownButton(t('Clear override', 'پاک‌کردن اتصال اختصاصی'), 'binding-clear', 'ghost') : '') + context.btn(t('Close', 'بستن'), 'close'));
    window.ATL_MY_TASKS.bindingDraft = { ...data, item };
  }
  async function urgency(key) {
    const data = await api(`/api/my-tasks/triage?key=${encodeURIComponent(key)}&locale=${context.locale}`), detail = data.triage;
    if (!detail) return;
    const labels = { impact: t('Business impact', 'اثر اختلال'), timing: t('Time sensitivity', 'حساسیت زمانی'), blocking: t('Blocking others', 'مسدودکننده‌ها'), priority: t('Source priority', 'اولویت منبع') };
    context.popupWide(t('ATL urgency estimate', 'برآورد فوریت ATL'), `<div class="mtr-tabpanel"><p class="mtr-summary">${e(detail.score == null ? t('Urgency unknown', 'فوریت نامشخص') : `${detail.score}/100`)}</p><p>${e(t('An estimated score, not a probability. Source priority is unchanged.', 'این عدد امتیاز تخمینی است، نه احتمال. اولویت منبع تغییر نکرده است.'))}</p>${detail.stale ? `<p class="amber">${e(t('Needs updating', 'نیازمند به‌روزرسانی'))}</p>` : ''}<p dir="auto">${e(detail.explanation?.reason || t('Select an available GLM Flash model in Analysis & Jira settings.', 'در تنظیمات تحلیل و Jira یک مدل GLM Flash در دسترس انتخاب کنید.'))}</p><dl class="mtr-metadata">${Object.entries(detail.factors || {}).map(([name, factor]) => `<div><dt>${e(labels[name])}</dt><dd dir="auto">${e(factor ? `${factor.score}/100 · ${factor.evidence}` : t('Unknown', 'نامشخص'))}</dd></div>`).join('')}</dl>${detail.explanation?.missing?.length ? `<h3>${e(t('Missing information', 'اطلاعات ناموجود'))}</h3><ul>${detail.explanation.missing.map(text => `<li>${e(text)}</li>`).join('')}</ul>` : ''}<p>${e(t('Confidence', 'اطمینان'))}: ${e(({ low: t('Low', 'پایین'), medium: t('Medium', 'متوسط'), high: t('High', 'بالا') })[detail.confidence] || '—')}</p><p>${e(detail.generated_at ? new Date(detail.generated_at).toLocaleString(context.locale) : '')} · ${e(detail.model || '')}</p></div>`, `${ownButton(t('Retry analysis', 'تلاش مجدد تحلیل'), `triage-retry:${encodeURIComponent(key)}`, 'sm')}${context.btn(t('Close', 'بستن'), 'close', 'ghost')}`, 'mtr-detail-dialog');
  }
  async function analysisSettings() {
    const [triage, jira, providers] = await Promise.all([api('/api/my-tasks/triage/settings'), api('/api/my-tasks/jira/status'), api('/api/providers')]);
    const cfg = triage.settings, connection = jira.jira;
    const choices = [...(providers.providers || []).filter(p => p.ready), ...(providers.builtin || []).filter(p => p.installed && p.signedIn)].flatMap(p => [...new Set([p.model, ...(p.models || []).map(m => typeof m === 'string' ? m : m.id)])].filter(m => typeof m === 'string' && /glm.*flash/i.test(m)).map(model => ({ provider: p.id, model })));
    window.ATL_MY_TASKS.triageChoices = choices;
    window.ATL_MY_TASKS.jiraConfig = connection;
    context.popupWide(t('Analysis & Jira settings', 'تنظیمات تحلیل و Jira'), `<div class="mtr-tabpanel mtr-analysis-settings"><div id="mtrBindingError" role="status"></div><h3>${e(t('Low-cost urgency analysis', 'تحلیل کم‌هزینهٔ فوریت'))}</h3><p>${e(t('GLM Flash only; no automatic model fallback. Your review model is unchanged.', 'فقط GLM Flash؛ بدون جایگزینی خودکار مدل. مدل review شما تغییر نمی‌کند.'))}</p><label><input id="mtrTriageEnabled" type="checkbox" ${cfg.enabled ? 'checked' : ''}> ${e(t('Analyze urgency in the background', 'تحلیل فوریت در پس‌زمینه'))}</label><label>${e(t('Available model', 'مدل در دسترس'))}<select id="mtrTriageModel" class="input"><option value="">${e(t('Select a model', 'انتخاب مدل'))}</option>${choices.map((c, index) => `<option value="${index}" ${cfg.provider === c.provider && cfg.model === c.model ? 'selected' : ''}>${e(c.provider)} · ${e(c.model)}</option>`).join('')}</select></label>${!choices.length ? `<p class="amber">${e(t('No GLM Flash model is listed. Add or refresh models in Settings → Providers.', 'مدل GLM Flash ثبت نشده است. فهرست مدل‌ها را در تنظیمات ارائه‌دهنده اضافه یا تازه کنید.'))}</p>` : ''}<label>${e(t('Daily attempt limit', 'سقف تلاش روزانه'))}<input id="mtrTriageLimit" class="input" type="number" min="1" max="10000" value="${e(cfg.daily_limit)}"></label>${ownButton(t('Save analysis settings', 'ذخیرهٔ تنظیمات تحلیل'), 'triage-save', 'primary')}<hr><h3>Jira Cloud</h3><p>${e(connection.site?.name || t('Not connected', 'متصل نیست'))} · ${e(connection.status)}</p>${connection.error ? `<p class="amber">${e(connection.error)}</p>` : ''}<div class="mtr-tools">${ownButton(t('Connect / reconnect', 'اتصال / اتصال مجدد'), 'jira-authorize')}${ownButton(t('Load sites', 'دریافت سایت‌ها'), 'jira-sites')}${ownButton(t('Disconnect', 'قطع اتصال'), 'jira-disconnect', 'ghost')}</div><label>${e(t('Site', 'سایت'))}<select id="mtrJiraSite" class="input">${connection.site ? `<option value="${e(connection.site.id)}">${e(connection.site.name || connection.site.url)}</option>` : '<option value="">—</option>'}</select></label><label>${e(t('Project keys (comma separated)', 'کلید پروژه‌ها با کاما'))}<input id="mtrJiraProjects" class="input" dir="ltr" value="${e(connection.projects.join(', '))}" placeholder="APP, WEB"></label><label>${e(t('Sync interval (minutes)', 'فاصلهٔ همگام‌سازی (دقیقه)'))}<input id="mtrJiraInterval" type="number" class="input" min="1" max="1440" value="${e(connection.interval_minutes)}"></label><div class="mtr-tools">${ownButton(t('Load projects', '\u062f\u0631\u06cc\u0627\u0641\u062a \u067e\u0631\u0648\u0698\u0647\u200c\u0647\u0627'), 'jira-projects')}${ownButton(t('Save Jira settings', 'ذخیرهٔ تنظیمات Jira'), 'jira-save', 'primary')}${ownButton(t('Sync Jira now', 'همگام‌سازی Jira'), 'jira-sync')}${ownButton(t('Review pending actions', 'بررسی عملیات در انتظار'), 'jira-proposals')}</div><div id="mtrJiraMessage" role="status"></div></div>`, context.btn(t('Close', 'بستن'), 'close', 'ghost'), 'mtr-detail-dialog');
  }
  async function jiraProposals() {
    const { proposals } = await api('/api/my-tasks/jira/status');
    context.popupWide(t('Jira action previews', 'پیش‌نمایش عملیات Jira'), `<div class="mtr-tabpanel"><div id="mtrBindingError" role="status"></div>${proposals.length ? proposals.map(p => `<section class="mtr-jira-proposal"><h3>${e(p.issueKey)} · ${e(p.operation)}</h3><p dir="auto">${e(p.site.name || p.site.url)}</p><p>${e(p.status)}</p><pre dir="ltr">${e(JSON.stringify({ before: p.before, changes: p.changes }, null, 2))}</pre>${p.status === 'pending' ? `${ownButton(t('Approve and send', 'تأیید و ارسال'), `jira-approve:${p.id}`, 'primary')}${ownButton(t('Cancel', 'لغو'), `jira-cancel:${p.id}`, 'ghost')}` : `<p>${e(t('Check Jira before retrying. This action will not be replayed.', 'پیش از تلاش دوباره Jira را بررسی کنید. این عملیات تکرار نخواهد شد.'))}</p>`}</section>`).join('') : `<p>${e(t('No pending actions.', 'عملیاتی در انتظار نیست.'))}</p>`}</div>`, context.btn(t('Close', 'بستن'), 'close', 'ghost'), 'mtr-detail-dialog');
  }
  async function action(value, source = null) {
    const [name, arg] = value.split(':');
    if (name === 'urgency') return urgency(decodeURIComponent(arg));
    if (name === 'triage-retry') { await api('/api/my-tasks/triage/retry', { key: decodeURIComponent(arg) }); return urgency(decodeURIComponent(arg)); }
    if (name === 'analysis-settings') return analysisSettings();
    if (name === 'triage-save') {
      const choice = window.ATL_MY_TASKS.triageChoices[document.getElementById('mtrTriageModel').value];
      const enabled = document.getElementById('mtrTriageEnabled').checked;
      if (enabled && !choice) throw Error(t('Select an available model.', 'یک مدل در دسترس انتخاب کنید.'));
      await api('/api/my-tasks/triage/settings', { ...(choice || {}), enabled, daily_limit: Number(document.getElementById('mtrTriageLimit').value) }); return analysisSettings();
    }
    if (name === 'jira-authorize') { const data = await api('/api/my-tasks/jira/authorize', {}); if (data.result.authorization_url) { const a = document.createElement('a'); a.href = data.result.authorization_url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = t('Continue Jira sign-in', 'ادامهٔ ورود به Jira'); document.getElementById('mtrJiraMessage').replaceChildren(a); a.focus(); } return; }
    if (name === 'jira-sites') { const data = await api('/api/my-tasks/jira/sites'); document.getElementById('mtrJiraSite').innerHTML = data.sites.map(s => `<option value="${e(s.id)}">${e(s.name || s.url)}</option>`).join(''); return; }
    if (name === 'jira-projects') { const data = await api(`/api/my-tasks/jira/projects?site=${encodeURIComponent(document.getElementById('mtrJiraSite').value)}`); const chosen = document.getElementById('mtrJiraProjects').value.split(',').map(v => v.trim()); document.getElementById('mtrJiraMessage').innerHTML = data.projects.map(p => `<label><input type="checkbox" data-mtr-jira-project="${e(p.key)}" ${chosen.includes(p.key) ? 'checked' : ''}> ${e(p.name || p.key)} (${e(p.key)})</label>`).join(''); return; }
    if (name === 'jira-save') { await api('/api/my-tasks/jira/settings', { site_id: document.getElementById('mtrJiraSite').value, projects: document.getElementById('mtrJiraProjects').value.split(',').map(v => v.trim()).filter(Boolean), interval_minutes: Number(document.getElementById('mtrJiraInterval').value) }); context.refresh(); return analysisSettings(); }
    if (name === 'jira-sync') { await api('/api/my-tasks/jira/sync', {}); context.refresh(); return analysisSettings(); }
    if (name === 'jira-disconnect') { await api('/api/my-tasks/jira/disconnect', {}); context.refresh(); return analysisSettings(); }
    if (name === 'jira-proposals') return jiraProposals();
    if (name === 'jira-approve' || name === 'jira-cancel') { await api('/api/my-tasks/jira/commit', { id: arg, approved: name === 'jira-approve' }); context.refresh(); return jiraProposals(); }
    if (name === 'view') { preferences.view = arg; savePreferences(); repaint(); }
    if (name === 'more') { preferences.limits[arg] = (preferences.limits[arg] || initialLimit()) + 30; repaint(); }
    if (name === 'tab' && opened) {
      opened.tab = arg; showDetail(); document.getElementById(`mtr-tab-${arg}`)?.focus();
      if (arg === 'prep' && opened.item.source !== 'jira' && !opened.prep) void loadPrep(opened.item);
    }
    if (name === 'zoom') document.querySelector('.mtr-diagram')?.classList.toggle('is-enlarged');
    if (name === 'previous') { const data = await api(`/api/my-tasks/review?key=${encodeURIComponent(opened.item.key)}&locale=${arg}`); opened.review = data.review; showDetail(); }
    if (name === 'bindings') await bindings();
    if (name === 'item-binding') await bindings(opened.item);
    // Spec 022 preparation actions. Every mutation re-reads the record, so a
    // failed provider call or a 409 conflict never blanks the panel.
    if (name.startsWith('prep-') && !opened) return;
    if (name === 'prep-load' && opened.item) return loadPrep(opened.item);
    if (name === 'prep-save' && opened.prep?.record) {
      syncPrepDraft();
      const draft = opened.prepDraft;
      await api('/api/my-tasks/preparation/save', { key: opened.item.key, revision: opened.prep.record.revision, patch: { outcome: draft.outcome, existing_behavior: draft.existing_behavior, requested_behavior: draft.requested_behavior, scope: draft.scope, acceptance_examples: draft.acceptance_examples, next_action: draft.next_action } });
      return loadPrep(opened.item);
    }
    if (name === 'prep-question' && opened.prep?.record) {
      syncPrepDraft();
      await api('/api/my-tasks/preparation/question', { key: opened.item.key, revision: opened.prep.record.revision, question: { kind: document.getElementById('prepQKind')?.value, question: document.getElementById('prepQText')?.value, why: document.getElementById('prepQWhy')?.value } });
      return loadPrep(opened.item);
    }
    if (name === 'prep-answer' && opened.prep?.record) {
      syncPrepDraft();
      const answer = source?.dataset?.prepOption || document.getElementById(`prepAnswer-${arg}`)?.value || '';
      await api('/api/my-tasks/preparation/answer', { key: opened.item.key, revision: opened.prep.record.revision, questionId: arg, answer });
      return loadPrep(opened.item);
    }
    if (name === 'prep-discover' && opened.item) {
      if (opened.prepBusy) throw new Error(t('A discovery run is already in flight for this task.', 'یک اجرای کشف برای این تسک در جریان است.'));
      syncPrepDraft();
      opened.prepBusy = 'discovery';
      showDetail();
      try { await api('/api/my-tasks/preparation/investigate', { key: opened.item.key, revision: opened.prep?.record?.revision, mode: 'discovery' }); }
      finally { opened.prepBusy = null; }
      return loadPrep(opened.item);
    }
    if (name === 'prep-notes' && opened.prep?.record) {
      syncPrepDraft();
      await api('/api/my-tasks/preparation/investigate', { key: opened.item.key, revision: opened.prep.record.revision, mode: 'manual', notes: document.getElementById('prepManual')?.value });
      return loadPrep(opened.item);
    }
    if (name === 'prep-handoff' && opened.item) {
      const data = await api('/api/my-tasks/preparation/handoff', { key: opened.item.key });
      const handoff = data.handoff;
      await loadPrep(opened.item);
      await Promise.resolve(context.refresh?.());
      if (handoff?.task_id) void openInStudio(handoff.task_id, handoff.repository_ids?.[0] || null);
      return;
    }
    if (name === 'retry' || name === 'resume') {
      await api(name === 'retry' ? '/api/my-tasks/review/retry' : '/api/my-tasks/reviews/ensure', { locale: context.locale, ...(name === 'retry' ? { key: opened.item.key } : {}), resume: true });
      if (name === 'retry') await open(opened.item);
      context.refresh();
    }
    if (name.startsWith('binding-')) {
      const draft = window.ATL_MY_TASKS.bindingDraft;
      if (name === 'binding-edit') {
        const rule = draft.bindings.rules[Number(arg)]; draft.editIndex = Number(arg); const selector = document.getElementById('mtrBindingProject'); selector.selectedIndex = [...selector.options].findIndex(option => option.value === rule.project && option.dataset.connection === rule.connection); document.getElementById('mtrBindingArea').value = rule.area;
        document.querySelectorAll('[data-mtr-repo]').forEach(input => { input.checked = rule.repository_ids.includes(input.dataset.mtrRepo); }); return;
      }
      if (name === 'binding-remove') draft.bindings.rules.splice(Number(arg), 1);
      if (name === 'binding-clear') delete draft.bindings.items[draft.item.key];
      if (name === 'binding-save') {
        const repository_ids = [...document.querySelectorAll('[data-mtr-repo]:checked')].map(input => input.dataset.mtrRepo);
        if (draft.item) draft.bindings.items[draft.item.key] = repository_ids;
        else {
          const project = document.getElementById('mtrBindingProject').value, area = document.getElementById('mtrBindingArea').value.trim(), connection = document.getElementById('mtrBindingProject').selectedOptions[0]?.dataset.connection;
          if (!project || !connection) throw new Error(t('Select a project first.', 'ابتدا یک پروژه انتخاب کنید.'));
          draft.bindings.rules = draft.bindings.rules.filter((r, index) => index !== draft.editIndex && !(r.connection === connection && r.project === project && r.area === area)); draft.bindings.rules.push({ connection, project, area, repository_ids });
        }
      }
      await api('/api/my-tasks/repository-bindings', draft.bindings);
      if (draft.item) await open(draft.item); else await bindings();
    }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-mtr-action]');
    if (!button) return;
    event.preventDefault();
    void action(button.dataset.mtrAction, button).catch(error => { const node = document.getElementById('mtrPrepError') || document.getElementById('mtrBindingError') || document.querySelector('.mtr-tabpanel'); if (node) { const p = document.createElement('p'); p.setAttribute('role', 'alert'); p.textContent = error.message; node.append(p); } });
  });
  document.addEventListener('input', event => {
    if (event.target.id !== 'mtrSearch') return;
    const cursor = event.target.selectionStart; preferences.query = event.target.value; preferences.limits = {}; savePreferences(); repaint(); const input = document.getElementById('mtrSearch'); input?.focus(); input?.setSelectionRange(cursor, cursor);
  });
  document.addEventListener('change', event => { if (event.target.matches('[data-mtr-jira-project]')) document.getElementById('mtrJiraProjects').value = [...document.querySelectorAll('[data-mtr-jira-project]:checked')].map(el => el.dataset.mtrJiraProject).join(', '); if (event.target.matches('[data-mtr-filter]')) { preferences[event.target.dataset.mtrFilter] = event.target.value; preferences.limits = {}; savePreferences(); repaint(); } });
  document.addEventListener('toggle', event => { if (event.target.matches?.('.mtr-more-filters') && event.target.isConnected) { preferences.advanced = event.target.open; savePreferences(); } if (event.target.matches?.('[data-mtr-group]') && event.target.isConnected && preferences.view !== 'kanban') { preferences.open[event.target.dataset.mtrGroup] = event.target.open; savePreferences(); } }, true);
  document.addEventListener('keydown', event => {
    const dialog = document.querySelector('.mtr-detail-dialog');
    if (!dialog) return;
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button:not([disabled]),a[href],input,select,textarea,[tabindex="0"],summary')].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.target.matches('[role=tab]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const tabs = [...dialog.querySelectorAll('[role=tab]')], index = tabs.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      void action(tabs[next].dataset.mtrAction);
    }
  });
  window.ATL_MY_TASKS = { render, open, bindings };
})();
