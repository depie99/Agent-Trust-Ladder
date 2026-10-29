/* Shared documentation behavior. No remote services or analytics. */
const $ = selector => document.querySelector(selector);
const dialog = $('#search-dialog');
const input = $('#search-input');
let index;
let previousFocus;
try { document.documentElement.dataset.theme = localStorage.getItem('atl-docs-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch {}
$('#theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('atl-docs-theme',theme); } catch {}
});
$('#menu-toggle').addEventListener('click', event => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  event.currentTarget.setAttribute('aria-expanded',String(open));
  $('#sidebar').classList.toggle('open',open);
});
async function search() {
  const target = $('#search-results');
  if (!index) { try { const response = await fetch('search-index.json'); if (!response.ok) throw new Error(); index = await response.json(); } catch { target.textContent='Search could not load. Serve the docs over HTTP, or use the navigation.'; return; } }
  const terms = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  target.replaceChildren();
  if (!terms.length) { target.textContent='Search all guides and reference pages.'; return; }
  const scored = index.map(item=>({item,score:terms.reduce((score,term)=>score+(item.title.toLowerCase().includes(term)?5:0)+(item.heading.toLowerCase().includes(term)?3:0),0)})).filter(({item})=>terms.every(term=>(item.title+' '+item.heading+' '+item.text).toLowerCase().includes(term))).sort((a,b)=>b.score-a.score).slice(0,12);
  if (!scored.length) { target.textContent='No results. Try fewer words or a feature name.'; return; }
  for (const {item} of scored) { const link=document.createElement('a'); link.href=item.url; const title=document.createElement('strong'); title.textContent=item.title+' / '+item.heading; const excerpt=document.createElement('span'); excerpt.textContent=item.text.slice(0,180)+'…'; link.append(title,excerpt); target.append(link); }
}
function openSearch() { previousFocus=document.activeElement; dialog.showModal(); input.focus(); search(); }
$('#search-open').addEventListener('click',openSearch);
$('#search-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>previousFocus?.focus());
input.addEventListener('input',search);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&dialog.open){event.preventDefault();dialog.close();return;}
  if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k') { event.preventDefault(); if(!dialog.open) openSearch(); }
});
for (const button of document.querySelectorAll('.copy-code')) button.addEventListener('click',async()=>{ try { await navigator.clipboard.writeText(button.parentElement.querySelector('pre').textContent); button.textContent='Copied'; } catch { button.textContent='Select code to copy'; } });
