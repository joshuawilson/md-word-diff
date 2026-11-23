// Runs inside the webview. Receives pre-rendered HTML from the extension.
interface VsApi {
  postMessage(msg: unknown): void;
  getState(): State | undefined;
  setState(s: State): void;
}
interface State {
  view: 'rendered' | 'raw';
  hideUnchanged: boolean;
  scrollY: number;
}
interface RenderMsg {
  type: 'render';
  rendered: string;
  raw: string;
  stats: { changes: number; wordsAdded: number; wordsRemoved: number };
  label: string;
  pairing: 'loose' | 'normal' | 'strict';
  grouping: 'off' | '1' | '2';
}

declare function acquireVsCodeApi(): VsApi;

const vscode = acquireVsCodeApi();
const state: State = { view: 'rendered', hideUnchanged: false, scrollY: 0, ...(vscode.getState() ?? {}) };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const views = { rendered: $('rendered'), raw: $('raw') };
let current = -1;

function save(): void {
  vscode.setState(state);
}

function setActive(group: HTMLElement, attr: string, value: string): void {
  group.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.getAttribute(attr) === value));
}

function applyView(): void {
  views.rendered.classList.toggle('view-hidden', state.view !== 'rendered');
  views.raw.classList.toggle('view-hidden', state.view !== 'raw');
  setActive($('view'), 'data-v', state.view);
  current = -1;
}

/**
 * Collapse runs of >= 2 consecutive unchanged siblings into a clickable row. Works at every
 * nesting level: a top-level list or quote with no changes collapses as a unit; inside one that
 * has changes, runs of unchanged items (<li>) or blocks collapse at that level.
 */
function applyHide(root: HTMLElement): void {
  root.querySelectorAll('.collapsed-run').forEach(el => el.remove());
  root.querySelectorAll('.run-hidden').forEach(el => el.classList.remove('run-hidden'));
  if (state.hideUnchanged) collapseIn(root);
}

const blockCount = (el: Element) => (el.matches('.blk') ? 1 : el.querySelectorAll('.blk').length);
const hasChange = (el: Element) => el.matches('.chg') || el.querySelector('.chg') !== null;

function collapseIn(parent: Element): void {
  let run: HTMLElement[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const members = run;
      const n = members.reduce((sum, el) => sum + blockCount(el), 0);
      members.forEach(el => el.classList.add('run-hidden'));
      const row = document.createElement(parent.tagName === 'UL' || parent.tagName === 'OL' ? 'li' : 'div');
      row.className = 'collapsed-run';
      row.textContent = `… ${n} unchanged block${n === 1 ? '' : 's'} …`;
      row.addEventListener('click', () => {
        members.forEach(el => el.classList.remove('run-hidden'));
        row.remove();
      });
      parent.insertBefore(row, members[0]);
    }
    run = [];
  };
  for (const child of Array.from(parent.children) as HTMLElement[]) {
    if (blockCount(child) === 0) continue;
    if (!hasChange(child)) {
      run.push(child);
    } else {
      flush();
      if (!child.matches('.blk')) collapseIn(child);
    }
  }
  flush();
}

function changes(): HTMLElement[] {
  return Array.from(views[state.view].querySelectorAll<HTMLElement>('.blk.chg'));
}

function go(dir: 1 | -1): void {
  const list = changes();
  if (!list.length) return;
  if (current < 0) {
    // Start from the first change below (or above) the current viewport top.
    const top = 60;
    const idx = list.findIndex(el => el.getBoundingClientRect().top > top);
    current = dir === 1 ? (idx < 0 ? list.length - 1 : idx) : Math.max(0, (idx < 0 ? list.length : idx) - 1);
  } else {
    current = Math.min(list.length - 1, Math.max(0, current + dir));
  }
  const el = list[current];
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 600);
}

window.addEventListener('message', (e: MessageEvent<RenderMsg>) => {
  const msg = e.data;
  if (msg.type !== 'render') return;
  const y = window.scrollY || state.scrollY;
  views.rendered.innerHTML = msg.rendered;
  views.raw.innerHTML = msg.raw;
  $('label').textContent = msg.label;
  const s = msg.stats;
  $('stats').textContent = `${s.changes} change${s.changes === 1 ? '' : 's'} · +${s.wordsAdded} / −${s.wordsRemoved} words`;
  setActive($('pairing'), 'data-p', msg.pairing);
  setActive($('grouping'), 'data-g', msg.grouping);
  applyHide(views.rendered);
  applyHide(views.raw);
  current = -1;
  window.scrollTo(0, y);
});

$('view').addEventListener('click', e => {
  const v = (e.target as HTMLElement).getAttribute('data-v');
  if (v === 'rendered' || v === 'raw') {
    state.view = v;
    applyView();
    save();
  }
});
$('pairing').addEventListener('click', e => {
  const p = (e.target as HTMLElement).getAttribute('data-p');
  if (p) vscode.postMessage({ type: 'pairing', value: p });
});
$('grouping').addEventListener('click', e => {
  const g = (e.target as HTMLElement).getAttribute('data-g');
  if (g) vscode.postMessage({ type: 'grouping', value: g });
});
$('prev').addEventListener('click', () => go(-1));
$('next').addEventListener('click', () => go(1));
const hide = $<HTMLInputElement>('hide');
hide.checked = state.hideUnchanged;
hide.addEventListener('change', () => {
  state.hideUnchanged = hide.checked;
  applyHide(views.rendered);
  applyHide(views.raw);
  save();
});
document.addEventListener('keydown', e => {
  if (e.altKey && e.key === 'ArrowDown') {
    e.preventDefault();
    go(1);
  } else if (e.altKey && e.key === 'ArrowUp') {
    e.preventDefault();
    go(-1);
  }
});
document.addEventListener('click', e => {
  if ((e.target as HTMLElement).closest('a')) e.preventDefault();
});
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('scroll', () => {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    state.scrollY = window.scrollY;
    save();
  }, 200);
});

applyView();
vscode.postMessage({ type: 'ready' });
