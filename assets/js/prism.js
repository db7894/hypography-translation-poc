const DATA_URL = './data/jingyesi.json';

// --- DOM refs
const $source   = document.getElementById('source');
const $target   = document.getElementById('target');
const $popover  = document.getElementById('popover');
const $pinyin   = document.getElementById('pinyinToggle');
const $hint     = document.getElementById('postChoiceHint');

// --- State (in-memory; persist minimal picks to localStorage)
let DOC = null;
let picks = {}; // { line: altIndex }
const KEY = 'prism:jingyesi:picks';

// Strategy ranking
const STRATEGIES = { literal: false, natural: false, foreignizing: false };

function scoreAlt(alt, strategies) {
  const w = alt.weights || {};
  let s = 0;
  for (const k of Object.keys(strategies)) {
    if (strategies[k]) s += (w[k] || 0);
  }
  return s;
}

function sortByStrategy(choice){
  const arr = choice.alternatives.map((a,i)=>({a,i,score:scoreAlt(a,STRATEGIES)}));
  arr.sort((x,y)=> y.score - x.score);
  return arr; // [{a, i, score}, ...] in ranked order
}

function currentSelectionIndex(c){ return (picks[c.line] ?? c.selected); }

function axisScores(){
  let L=0,N=0,F=0,D=0, count=0;
  for (const c of DOC.target.choices){
    const a = c.alternatives[currentSelectionIndex(c)];
    if (!a) continue;
    const w = a.weights || {};
    L += (w.literal||0); N += (w.natural||0);
    F += (w.foreignizing||0); D += (1-(w.foreignizing||0)); // crude domesticating proxy
    count++;
  }
  const fmt = v => (Math.round((v/Math.max(1,count))*100))+'%';
  document.getElementById('axis-ln').textContent = `${fmt(L)} ← ${fmt(N)}`;
  document.getElementById('axis-fd').textContent = `${fmt(F)} ← ${fmt(D)}`;
}

function applyStrategyToAll(){
  for (const c of DOC.target.choices){
    // pick the alternative with the highest score under the current STRATEGIES
    let best = 0, bestScore = -Infinity;
    c.alternatives.forEach((a,i)=>{
      const w = a.weights || {};
      let s = 0;
      if (STRATEGIES.literal)      s += (w.literal||0);
      if (STRATEGIES.natural)      s += (w.natural||0);
      if (STRATEGIES.foreignizing) s += (w.foreignizing||0);
      if (s > bestScore){ bestScore = s; best = i; }
    });
    picks[c.line] = best;
  }
  localStorage.setItem(KEY, JSON.stringify(picks));
  renderTarget();
  axisScores();
}

// --- Utilities
const esc = s => (s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// position popover near a click
function placePopover(x, y) {
  const pad = 12;
  $popover.style.left = Math.max(pad, x) + 'px';
  $popover.style.top  = Math.max(pad, y) + 'px';
}

// render Chinese + optional Pinyin
function renderSource() {
  $source.classList.toggle('show-pinyin', $pinyin.checked);
  $source.innerHTML = DOC.source.lines.map(l =>
    `<div class="line">
       <div class="hanzi">${esc(l.text)}</div>
       <div class="pinyin">${esc(l.pinyin)}</div>
     </div>`
  ).join('');
}

// render English lines with clickable underlines
function renderTarget() {
  $target.innerHTML = '';
  const lines = DOC.target.surfaceLines.slice();
  DOC.target.choices.forEach(c => {
    const idx = (picks[c.line] ?? c.selected);
    lines[c.line] = c.alternatives[idx].text;
  });

  lines.forEach((t, i) => {
    const c = DOC.target.choices.find(x => x.line === i);
    const altCount = c ? c.alternatives.length : 0;
    const span = document.createElement('span');
    span.className = 'clickable';
    span.dataset.line = String(i);
    span.title = altCount ? `${altCount} alternatives` : '';
    // inline fade-replace scaffold
    span.innerHTML = `<span class="fade-replace"><span class="from">${esc(t)}</span><span class="to"></span></span>`;
    const div = document.createElement('div');
    div.className = 'tline';
    div.appendChild(span);
    $target.appendChild(div);
  });
}

// open popover with alternatives for a line
function openPopover(lineIdx, ev) {
  const choice = DOC.target.choices.find(c => c.line === lineIdx);
  if (!choice) return;

  const ranked = sortByStrategy(choice);
  const alreadyPicked = Object.prototype.hasOwnProperty.call(picks, lineIdx);

  $popover.innerHTML =
    togglesUI() +
    ranked.map(({a, i}) => {
      const chosen = (picks[lineIdx] ?? choice.selected) === i;
      const chips = (a.chips || []).map(c => `<span class="chip">${esc(c)}</span>`).join('');
      const bucket = a.bucket && alreadyPicked ? `<div class="bucket">${esc(a.bucket)}</div>` : '';
      const readerPref = a.readerCount ? renderReaderPreference(a) : '';
      const philosophy = a.philosophy ? `<div class="philosophy-tag ${a.philosophy}">${a.philosophy === 'foreignizing' ? '→ CN' : 'EN ←'}</div>` : '';

      return `<div class="option" data-line="${lineIdx}" data-alt="${i}" data-distance="${a.semanticDistance || 'medium'}">
                <div class="txt">${chosen ? '✅ ' : ''}${esc(a.text)}</div>
                ${philosophy}
                <div class="chips">
                  <div class="chips-label">Translation style:</div>
                  ${chips}
                </div>
                <div class="note">${esc(a.note || '')}</div>
                ${bucket}
                ${readerPref}
              </div>`;
    }).join('');

  // wire strategy toggles
  $popover.querySelectorAll('input[data-strat]').forEach(cb => {
    cb.addEventListener('change', (e)=>{
      STRATEGIES[e.target.dataset.strat] = e.target.checked;
      openPopover(lineIdx, ev); // re-render ranked view
    });
  });

  $popover.hidden = false;
  placePopover(ev.pageX, ev.pageY);
}

// Add to your applyAlternative function
function showImpact(lineIdx, altIdx) {
    const c = DOC.target.choices.find(x => x.line === lineIdx);
    const alt = c.alternatives[altIdx];
    
    // Calculate semantic distance from original
    const impact = alt.semanticDistance || 'medium';
    
    // Show brief indicator
    const indicator = document.createElement('div');
    indicator.className = `impact-indicator ${impact}`;
    indicator.textContent = impact === 'high' ? 'Major shift' : 
                           impact === 'low' ? 'Subtle change' : 'Moderate change';
    
    $target.appendChild(indicator);
    setTimeout(() => indicator.remove(), 2000);
}

function updateDelta(lineIdx, altIdx) {
  const c = DOC.target.choices.find(x => x.line === lineIdx);
  if (!c) return;
  const base = c.alternatives[c.selected]?.chips || [];
  const now  = c.alternatives[altIdx]?.chips || [];
  const gained = now.filter(t => !base.includes(t));
  const lost   = base.filter(t => !now.includes(t));

  // also show stakes sentence if present
  const stakes = c.stakes ? `<br><em>${esc(c.stakes)}</em>` : '';

  const el = document.getElementById('delta');
  if (!el) {
    const d = document.createElement('div');
    d.id = 'delta'; d.className = 'muted tiny';
    $target.insertAdjacentElement('afterend', d);
  }
  document.getElementById('delta').innerHTML =
    `<strong>What changed on line ${lineIdx+1}?</strong>
     <br>Emphasizes: ${gained.length ? gained.map(esc).join(', ') : '—'}
     <br>De‑emphasizes: ${lost.length ? lost.map(esc).join(', ') : '—'}${stakes}`;
}

function markRipples(fromLine, altIdx){
  const c = DOC.target.choices.find(x => x.line === fromLine);
  (c?.dependencies || []).forEach(dep => {
    const target = $target.querySelector(`.tline:nth-child(${dep.affectsLine+1})`);
    if (!target) return;
    let dot = target.querySelector('.ripple');
    if (!dot) { dot = document.createElement('span'); dot.className = 'ripple'; target.appendChild(dot); }
    const msg = dep.delta < 0
      ? `Parallelism weakened by line ${fromLine+1} choice`
      : `Parallelism strengthened by line ${fromLine+1} choice`;
    dot.classList.toggle('negative', (dep.delta||0) < 0);
    dot.setAttribute('title', msg); // native tooltip
  });
}

// In your popover rendering
function renderReaderPreference(alt, totalReaders = 1000) {
  const percentage = alt.readerCount / totalReaders;
  const width = Math.round(percentage * 100);
  
  return `
    <div class="reader-preference">
      <div class="bar" style="width: ${width}%"></div>
      <span class="label">${Math.round(percentage * 100)}% chose this</span>
    </div>
  `;
}

function togglesUI() {
  return `
    <div class="strategy">
      <label><input type="checkbox" data-strat="literal"> Favor literal</label>
      <label><input type="checkbox" data-strat="natural"> Favor natural</label>
      <label><input type="checkbox" data-strat="foreignizing"> Favor foreignizing</label>
    </div>`;
}

// handle swap with gentle animation + persistence
function applyAlternative(lineIdx, altIdx) {
  const c = DOC.target.choices.find(x => x.line === lineIdx);
  if (!c) return;
  const text = c.alternatives[altIdx].text;

  // Show impact indicator for semantic changes
  showImpact(lineIdx, altIdx);

  // swap in DOM with fade animation
  const lineEl = $target.querySelector(`.tline:nth-child(${lineIdx+1}) .fade-replace`);
  if (!lineEl) return;
  lineEl.querySelector('.to').textContent = text;
  // trigger CSS transition
  lineEl.classList.add('swap');
  setTimeout(() => {
    // commit final text (set "from" = chosen; reset)
    lineEl.innerHTML = `<span class="from">${esc(text)}</span><span class="to"></span>`;
    lineEl.classList.remove('swap');
  }, 220);

  // persist pick and show post-selection hint
  picks[lineIdx] = altIdx;
  localStorage.setItem(KEY, JSON.stringify(picks));
  $hint.hidden = false;
  
  // Show ripple effects for constraints
  markRipples(lineIdx, altIdx);
  
  // Show what changed
  updateDelta(lineIdx, altIdx);
  
  // Update axis scores
  axisScores();
}

// --- Events
$target.addEventListener('click', (e) => {
  const span = e.target.closest('.clickable');
  if (!span) return;
  const line = parseInt(span.dataset.line, 10);
  openPopover(line, e);
  e.stopPropagation();
});

// click alternative in popover
$popover.addEventListener('click', (e) => {
  const opt = e.target.closest('.option');
  if (!opt) return;
  const line = parseInt(opt.dataset.line, 10);
  const alt  = parseInt(opt.dataset.alt, 10);
  $popover.hidden = true;
  applyAlternative(line, alt);
});

// clicking outside closes the popover
document.addEventListener('click', (e) => {
  if (!$popover.hidden && !e.target.closest('#popover')) $popover.hidden = true;
});

// pinyin toggle
$pinyin.addEventListener('change', renderSource);

// Reset to original
document.getElementById('resetOriginal').addEventListener('click', resetToOriginal);

// Show comparison
document.getElementById('showComparison').addEventListener('click', showComparison);

// Share reading
document.getElementById('shareReading')?.addEventListener('click', shareLink);

// Apply strategy to all lines
document.getElementById('applyStrategy')?.addEventListener('click', applyStrategyToAll);

// Export TEI
document.getElementById('exportTEI')?.addEventListener('click', exportTEI);

// --- Boot
(async function init(){
  try {
    const resp = await fetch(DATA_URL);
    DOC = await resp.json();
    // restore previous picks
    picks = JSON.parse(localStorage.getItem(KEY) || '{}');
    
    // Handle URL parameters for shared readings
    const v = new URL(location.href).searchParams.get('v');
    if (v) v.split('-').forEach((a,i)=>{ if (!isNaN(+a)) picks[i]=+a; });
    
    renderSource();
    renderTarget();
    axisScores();
  } catch (err) {
    console.error('Failed to load data:', err);
    $target.textContent = 'Failed to load poem.';
  }
})();

// Add these functions
function resetToOriginal() {
  picks = {};
  localStorage.removeItem(KEY);
  renderTarget();
  $hint.hidden = true;
}

function showComparison() {
  const original = DOC.target.choices.map(c => c.alternatives[c.selected].text);
  const current = DOC.target.choices.map(c => {
    const idx = picks[c.line] ?? c.selected;
    return c.alternatives[idx].text;
  });
  
  // Show side-by-side comparison
  const modal = document.createElement('div');
  modal.className = 'comparison-modal';
  modal.innerHTML = `
    <div class="comparison">
      <div>
        <h3>Original Translation</h3>
        ${original.map(line => `<div>${line}</div>`).join('')}
      </div>
      <div>
        <h3>Your Version</h3>
        ${current.map(line => `<div>${line}</div>`).join('')}
      </div>
      <button onclick="this.parentElement.parentElement.remove()">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function shareLink(){
  const lines = DOC.target.choices.map(c => (picks[c.line] ?? c.selected));
  const url = new URL(location.href);
  url.searchParams.set('v', lines.join('-'));
  navigator.clipboard.writeText(url.toString()).then(()=> alert('Link copied:\n'+url));
}

function exportTEI(){
  const escXML = s => s.replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
  let tei = `<?xml version="1.0" encoding="UTF-8"?>\n<TEI xmlns="http://www.tei-c.org/ns/1.0">\n  <text>\n    <body>\n      <lg type="poem" xml:id="jingyesi">\n`;
  DOC.target.choices.forEach((c,i)=>{
    const base = c.alternatives[c.selected];
    tei += `        <l n="${i+1}">\n          <app>\n            <lem>${escXML(base.text)}</lem>\n`;
    c.alternatives.forEach((a,idx)=>{
      const chosen = (picks[c.line] ?? c.selected) === idx;
      const ana = [ ...(a.chips||[]).map(t=>`#chip:${t}`), a.philosophy?`#phil:${a.philosophy}`:'' ].filter(Boolean).join(' ');
      tei += `            <rdg${ana?` ana="${escXML(ana)}"`:''}${chosen?' wit="#reader"':''}>${escXML(a.text)}</rdg>\n`;
    });
    tei += `          </app>\n        </l>\n`;
  });
  tei += `      </lg>\n    </body>\n  </text>\n</TEI>\n`;

  const blob = new Blob([tei], {type:"application/xml"});
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: "jingyesi-apparatus.xml" });
  document.body.appendChild(a); a.click(); a.remove();
}
