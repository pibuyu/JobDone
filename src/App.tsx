import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppData, Category, Locale, Task, TaskStatus, Workload } from './types';
import { CATEGORY_PALETTE, loadData, saveData, uid } from './store';
import { Confetti } from './confetti';
import { STRINGS, getLocaleFromSystem, type Strings } from './i18n';

type FilterTab = 'all' | 'active' | 'waiting' | 'done';

const WORKLOAD_CYCLE: (Workload | undefined)[] = [undefined, 'S', 'M', 'L'];

function workloadEmoji(w?: Workload): string {
  if (w === 'S') return '🟢';
  if (w === 'M') return '🟡';
  if (w === 'L') return '🔴';
  return '';
}
function workloadLabel(w: Workload | undefined, t: Strings): string {
  if (w === 'S') return t.workloadS;
  if (w === 'M') return t.workloadM;
  if (w === 'L') return t.workloadL;
  return t.workloadNone;
}

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function isToday(ts: number) { return startOfDay(ts) === startOfDay(Date.now()); }
function daysDiff(a: number, b: number) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

function useClickOutside<T extends HTMLElement>(active: boolean, onOut: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active, onOut]);
  return ref;
}

export default function App() {
  const [data, setData] = useState<AppData>({
    tasks: [],
    categories: [],
    settings: { alwaysOnTop: true },
  });
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('active');
  const [draft, setDraft] = useState('');
  const [confettiTick, setConfettiTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [composerCatId, setComposerCatId] = useState<string | undefined>(undefined);
  const [showComposerCat, setShowComposerCat] = useState(false);
  const [composerWorkload, setComposerWorkload] = useState<Workload | undefined>(undefined);
  const [showComposerWorkload, setShowComposerWorkload] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [openMoveTaskId, setOpenMoveTaskId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Pointer-based drag state — refs so the document-level listener reads
  // current values without re-binding on every render.
  const dragStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  const dropTargetIdRef = useRef<string | null>(null);
  draggedIdRef.current = draggedId;
  dropTargetIdRef.current = dropTargetId;

  // Cursor position during an active drag, for the floating ghost preview.
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);

  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const locale: Locale = data.settings.locale || 'en';
  const t: Strings = STRINGS[locale];
  const placeholder = useMemo(
    () => t.placeholders[Math.floor(Math.random() * t.placeholders.length)],
    [t]
  );

  useEffect(() => {
    loadData().then((d) => {
      // First-time install: default to system locale; persisted thereafter.
      if (d.settings.locale === undefined) {
        d.settings.locale = getLocaleFromSystem();
      }
      setData(d);
      setComposerCatId(d.categories.find((c) => c.id === 'work')?.id || d.categories[0]?.id);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveData(data);
  }, [data, loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (composerCatId && !data.categories.some((c) => c.id === composerCatId)) {
      setComposerCatId(data.categories.find((c) => c.id === 'work')?.id || data.categories[0]?.id);
    }
  }, [data.categories, composerCatId, loaded]);

  const tasks = data.tasks;
  const categories = data.categories;

  const filterCatId = data.settings.filterCategoryId ?? null;
  const filterCategory = filterCatId ? categories.find((c) => c.id === filterCatId) : null;

  const counts = useMemo(() => {
    const c = { active: 0, waiting: 0, done: 0, doneToday: 0 };
    const pool = filterCatId ? tasks.filter((t) => t.categoryId === filterCatId) : tasks;
    for (const t of pool) {
      c[t.status] += 1;
      if (t.status === 'done' && t.doneAt && isToday(t.doneAt)) c.doneToday += 1;
    }
    return { ...c, total: pool.length };
  }, [tasks, filterCatId]);

  const visible = useMemo(() => {
    let list = tasks;
    if (filterCatId) list = list.filter((t) => t.categoryId === filterCatId);
    if (filter === 'active') list = list.filter((t) => t.status === 'active');
    else if (filter === 'waiting') list = list.filter((t) => t.status === 'waiting');
    else if (filter === 'done') list = list.filter((t) => t.status === 'done');
    return [...list].sort((a, b) => {
      const order = (s: TaskStatus) => (s === 'active' ? 0 : s === 'waiting' ? 1 : 2);
      const so = order(a.status) - order(b.status);
      if (so !== 0) return so;
      // Within "done", show most recently completed first.
      if (a.status === 'done' && b.status === 'done') return (b.doneAt || 0) - (a.doneAt || 0);
      // Within active/waiting: preserve the underlying tasks array order
      // (JS Array.prototype.sort is stable since ES2019). This is what
      // makes drag-reorder work — the array order is the source of truth.
      return 0;
    });
  }, [tasks, filter, filterCatId]);

  const categoryById = useMemo(() => {
    const m: Record<string, Category> = {};
    for (const c of categories) m[c.id] = c;
    return m;
  }, [categories]);

  function addTask() {
    const text = draft.trim();
    if (!text) return;
    const task: Task = {
      id: uid(),
      text,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      categoryId: composerCatId,
      workload: composerWorkload,
    };
    setData((d) => ({ ...d, tasks: [task, ...d.tasks] }));
    setDraft('');
  }

  function cycleTaskWorkload(id: string) {
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => {
        if (t.id !== id) return t;
        const idx = WORKLOAD_CYCLE.indexOf(t.workload);
        const next = WORKLOAD_CYCLE[(idx + 1) % WORKLOAD_CYCLE.length];
        return { ...t, workload: next, updatedAt: Date.now() };
      }),
    }));
  }

  function reorderTasks(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setData((d) => {
      const ts = [...d.tasks];
      const sourceIdx = ts.findIndex((t) => t.id === sourceId);
      const targetIdx = ts.findIndex((t) => t.id === targetId);
      if (sourceIdx < 0 || targetIdx < 0) return d;
      const [moved] = ts.splice(sourceIdx, 1);
      const newTargetIdx = ts.findIndex((t) => t.id === targetId);
      ts.splice(newTargetIdx, 0, moved);
      return { ...d, tasks: ts };
    });
  }

  // Drag-to-reorder using mouse events. (We tried HTML5 drag and pointer
  // events; mouse events are the simplest thing that's reliable across
  // Electron's transparent always-on-top window quirks.)
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const start = dragStartRef.current;
      if (!start) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const inDrag = draggedIdRef.current !== null;

      if (!inDrag) {
        if (Math.hypot(dx, dy) < 4) return;
        setDraggedId(start.id);
      }

      setDragCursor({ x: e.clientX, y: e.clientY });

      const els = document.elementsFromPoint(e.clientX, e.clientY);
      const rowEl = els.find(
        (el) => el instanceof HTMLElement && el.classList.contains('row') && el.dataset.taskId
      ) as HTMLElement | undefined;

      const targetId = rowEl?.dataset.taskId;
      const next = targetId && targetId !== start.id ? targetId : null;
      if (dropTargetIdRef.current !== next) setDropTargetId(next);
    }

    function onUp() {
      const start = dragStartRef.current;
      const wasDragged = draggedIdRef.current;
      const target = dropTargetIdRef.current;
      dragStartRef.current = null;
      if (wasDragged) setDraggedId(null);
      if (dropTargetIdRef.current) setDropTargetId(null);
      setDragCursor(null);
      if (wasDragged && start && target && target !== start.id) {
        reorderTasks(start.id, target);
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  function startRowDrag(taskId: string, e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, .popover')) return;
    if (editingId === taskId) return;
    if (e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, id: taskId };
  }

  function setStatus(id: string, status: TaskStatus) {
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => {
        if (t.id !== id) return t;
        const updated: Task = { ...t, status, updatedAt: Date.now() };
        if (status === 'done') updated.doneAt = Date.now();
        if (t.status === 'done' && status !== 'done') updated.doneAt = undefined;
        return updated;
      }),
    }));
    if (status === 'done') setConfettiTick((n) => n + 1);
  }

  function moveTaskCategory(id: string, categoryId: string | undefined) {
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === id ? { ...t, categoryId, updatedAt: Date.now() } : t)),
    }));
  }

  function removeTask(id: string) {
    setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
  }

  function clearDone() {
    setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.status !== 'done') }));
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditingText(task.text);
  }

  function commitEdit() {
    if (!editingId) return;
    const id = editingId;
    const text = editingText.trim();
    if (!text) {
      removeTask(id);
    } else {
      setData((d) => ({
        ...d,
        tasks: d.tasks.map((t) => (t.id === id ? { ...t, text, updatedAt: Date.now() } : t)),
      }));
    }
    setEditingId(null);
    setEditingText('');
  }

  function addCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const color = CATEGORY_PALETTE[categories.length % CATEGORY_PALETTE.length];
    const c: Category = { id: uid(), name: trimmed, color };
    setData((d) => ({ ...d, categories: [...d.categories, c] }));
  }

  function renameCategory(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setData((d) => ({
      ...d,
      categories: d.categories.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
    }));
  }

  function cycleCategoryColor(id: string) {
    setData((d) => ({
      ...d,
      categories: d.categories.map((c) => {
        if (c.id !== id) return c;
        const idx = CATEGORY_PALETTE.indexOf(c.color);
        const next = CATEGORY_PALETTE[(idx + 1) % CATEGORY_PALETTE.length];
        return { ...c, color: next };
      }),
    }));
  }

  function deleteCategory(id: string) {
    setData((d) => ({
      ...d,
      categories: d.categories.filter((c) => c.id !== id),
      tasks: d.tasks.map((t) => (t.categoryId === id ? { ...t, categoryId: undefined } : t)),
    }));
  }

  function setLocale(next: Locale) {
    setData((d) => ({ ...d, settings: { ...d.settings, locale: next } }));
  }

  if (showSettings) {
    return (
      <SettingsPanel
        t={t}
        locale={locale}
        categories={categories}
        onClose={() => setShowSettings(false)}
        onHide={() => window.jobdone?.hide()}
        onMinimize={() => window.jobdone?.minimize()}
        onAdd={addCategory}
        onRename={renameCategory}
        onCycleColor={cycleCategoryColor}
        onDelete={deleteCategory}
        onSetLocale={setLocale}
      />
    );
  }

  const anyMenuOpen = openMoveTaskId !== null || showComposerCat || showComposerWorkload || showFilterMenu;

  function setFilterCategory(id: string | null) {
    setData((d) => ({ ...d, settings: { ...d.settings, filterCategoryId: id } }));
    setShowFilterMenu(false);
  }

  const draggedTaskText = draggedId
    ? tasks.find((t) => t.id === draggedId)?.text
    : null;

  return (
    <div className={`app ${anyMenuOpen ? 'menu-open' : ''} ${draggedId ? 'app-dragging' : ''}`}>
      <Confetti tick={confettiTick} />
      {draggedTaskText && dragCursor && (
        <div
          className="drag-ghost"
          style={{ left: dragCursor.x + 12, top: dragCursor.y - 8 }}
        >
          {draggedTaskText}
        </div>
      )}

      <header className="titlebar">
        <BrandFilter
          t={t}
          categories={categories}
          activeCategory={filterCategory || undefined}
          showMenu={showFilterMenu}
          onToggle={() => setShowFilterMenu((v) => !v)}
          onPick={setFilterCategory}
        />
        <div className="titlebar-actions">
          <button className="ico-btn" title={t.settings} onClick={() => setShowSettings(true)}>
            <svg width="13" height="13" viewBox="0 0 16 16">
              <path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
              <path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="ico-btn" title={t.minimize} onClick={() => window.jobdone?.minimize()}>
            <svg width="13" height="13" viewBox="0 0 14 14"><rect x="2" y="6.5" width="10" height="1.2" rx="0.6" fill="currentColor"/></svg>
          </button>
          <button className="ico-btn" title={t.hide} onClick={() => window.jobdone?.hide()}>
            <svg width="13" height="13" viewBox="0 0 14 14"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </button>
        </div>
      </header>

      <ComposerRow
        t={t}
        draft={draft}
        setDraft={setDraft}
        onSubmit={addTask}
        placeholder={placeholder}
        inputRef={inputRef}
        category={composerCatId ? categoryById[composerCatId] : undefined}
        categories={categories}
        showCatMenu={showComposerCat}
        setShowCatMenu={setShowComposerCat}
        onPickCategory={(id) => { setComposerCatId(id); setShowComposerCat(false); }}
        workload={composerWorkload}
        showWorkloadMenu={showComposerWorkload}
        setShowWorkloadMenu={setShowComposerWorkload}
        onPickWorkload={(w) => { setComposerWorkload(w); setShowComposerWorkload(false); }}
      />

      <nav className="tabs">
        <Tab label={t.tabActive} count={counts.active} active={filter === 'active'} onClick={() => setFilter('active')} />
        <Tab label={t.tabWaiting} count={counts.waiting} active={filter === 'waiting'} onClick={() => setFilter('waiting')} />
        <Tab label={t.tabDone} count={counts.done} active={filter === 'done'} onClick={() => setFilter('done')} />
      </nav>

      <main className="list">
        {visible.length === 0 ? (
          <div className="empty">
            {filter === 'done' ? t.emptyDone :
             filter === 'waiting' ? t.emptyWaiting :
             filter === 'active' ? (counts.waiting > 0 ? t.emptyActiveWithWaiting : t.emptyActive) :
             t.emptyActive}
          </div>
        ) : (
          visible.map((task) => (
            <TaskRow
              key={task.id}
              t={t}
              task={task}
              category={task.categoryId ? categoryById[task.categoryId] : undefined}
              categories={categories}
              editing={editingId === task.id}
              editingText={editingText}
              dragging={draggedId === task.id}
              dropTarget={dropTargetId === task.id && draggedId !== task.id}
              moveMenuOpen={openMoveTaskId === task.id}
              onToggleMoveMenu={() =>
                setOpenMoveTaskId((prev) => (prev === task.id ? null : task.id))
              }
              onCloseMoveMenu={() => setOpenMoveTaskId(null)}
              onEditStart={() => startEdit(task)}
              onEditChange={setEditingText}
              onEditCommit={commitEdit}
              onEditCancel={() => { setEditingId(null); setEditingText(''); }}
              onActive={() => setStatus(task.id, 'active')}
              onWait={() => setStatus(task.id, task.status === 'waiting' ? 'active' : 'waiting')}
              onDone={() => setStatus(task.id, task.status === 'done' ? 'active' : 'done')}
              onDelete={() => removeTask(task.id)}
              onMoveCategory={(catId) => moveTaskCategory(task.id, catId)}
              onCycleWorkload={() => cycleTaskWorkload(task.id)}
              onMouseDown={(e) => startRowDrag(task.id, e)}
            />
          ))
        )}
      </main>

      <footer className="foot">
        <span className="foot-text">
          {t.footerToday} <strong>{counts.doneToday}</strong> · {t.footerActive} <strong>{counts.active}</strong> · {t.footerWaiting} <strong>{counts.waiting}</strong>
        </span>
        {counts.done > 0 && (
          <button className="link-btn" onClick={clearDone}>{t.clearDone}</button>
        )}
      </footer>
    </div>
  );
}

function BrandFilter({
  t, categories, activeCategory, showMenu, onToggle, onPick,
}: {
  t: Strings;
  categories: Category[];
  activeCategory?: Category;
  showMenu: boolean;
  onToggle: () => void;
  onPick: (id: string | null) => void;
}) {
  const wrapRef = useClickOutside<HTMLDivElement>(showMenu, () => {
    if (showMenu) onToggle();
  });
  return (
    <div className="brand-wrap" ref={wrapRef}>
      <button
        className={`brand brand-btn ${activeCategory ? 'brand-filtered' : ''}`}
        onClick={onToggle}
        title={activeCategory ? `${t.settingsCategories}: ${activeCategory.name}` : t.brand}
      >
        <span
          className="dot"
          style={activeCategory ? { background: activeCategory.color, boxShadow: `0 0 10px ${activeCategory.color}` } : undefined}
        />
        <span className="brand-label">{activeCategory ? activeCategory.name : t.brand}</span>
        <svg className="brand-caret" width="7" height="7" viewBox="0 0 8 8">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        </svg>
      </button>
      {showMenu && (
        <div className="popover popover-below-left">
          <button
            className={`popover-item ${!activeCategory ? 'popover-item-active' : ''}`}
            onClick={() => onPick(null)}
          >
            <span className="popover-dot" style={{ background: 'linear-gradient(135deg, #7c5cff, #4dd0ff)' }} />
            {t.brand}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`popover-item ${activeCategory?.id === c.id ? 'popover-item-active' : ''}`}
              onClick={() => onPick(c.id)}
            >
              <span className="popover-dot" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ComposerRow({
  t, draft, setDraft, onSubmit, placeholder, inputRef,
  category, categories, showCatMenu, setShowCatMenu, onPickCategory,
  workload, showWorkloadMenu, setShowWorkloadMenu, onPickWorkload,
}: {
  t: Strings;
  draft: string;
  setDraft: (s: string) => void;
  onSubmit: () => void;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  category?: Category;
  categories: Category[];
  showCatMenu: boolean;
  setShowCatMenu: (b: boolean) => void;
  onPickCategory: (id: string | undefined) => void;
  workload: Workload | undefined;
  showWorkloadMenu: boolean;
  setShowWorkloadMenu: (b: boolean) => void;
  onPickWorkload: (w: Workload | undefined) => void;
}) {
  const catRef = useClickOutside<HTMLDivElement>(showCatMenu, () => setShowCatMenu(false));
  const wlRef = useClickOutside<HTMLDivElement>(showWorkloadMenu, () => setShowWorkloadMenu(false));
  return (
    <section className="composer">
      <div className="composer-cat-wrap" ref={catRef}>
        <button
          className="composer-cat-chip"
          onClick={() => setShowCatMenu(!showCatMenu)}
          title={t.composerCatTooltip}
        >
          <span
            className="composer-cat-dot"
            style={{ background: category?.color || 'transparent', border: category ? 'none' : '1px dashed rgba(255,255,255,0.3)' }}
          />
          <span className="composer-cat-name">{category?.name || t.uncategorized}</span>
          <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/></svg>
        </button>
        {showCatMenu && (
          <div className="popover popover-below-left">
            {categories.map((c) => (
              <button
                key={c.id}
                className={`popover-item ${category?.id === c.id ? 'popover-item-active' : ''}`}
                onClick={() => onPickCategory(c.id)}
              >
                <span className="popover-dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
            <button
              className={`popover-item ${!category ? 'popover-item-active' : ''}`}
              onClick={() => onPickCategory(undefined)}
            >
              <span className="popover-dot popover-dot-none" />
              {t.uncategorized}
            </button>
          </div>
        )}
      </div>

      <div className="composer-wl-wrap" ref={wlRef}>
        <button
          className="composer-wl-chip"
          onClick={() => setShowWorkloadMenu(!showWorkloadMenu)}
          title={t.composerWorkloadTooltip}
        >
          <span className="composer-wl-emoji">{workloadEmoji(workload) || '🏋️'}</span>
          <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/></svg>
        </button>
        {showWorkloadMenu && (
          <div className="popover popover-below-left">
            <button
              className={`popover-item ${!workload ? 'popover-item-active' : ''}`}
              onClick={() => onPickWorkload(undefined)}
            >
              <span className="popover-dot popover-dot-none" />
              {t.workloadNone}
            </button>
            {(['S', 'M', 'L'] as Workload[]).map((w) => (
              <button
                key={w}
                className={`popover-item ${workload === w ? 'popover-item-active' : ''}`}
                onClick={() => onPickWorkload(w)}
              >
                <span className="popover-emoji">{workloadEmoji(w)}</span>
                {workloadLabel(w, t)}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
        placeholder={placeholder}
        className="composer-input"
        autoFocus
      />
      <button className="composer-btn" onClick={onSubmit} disabled={!draft.trim()}>{t.add}</button>
    </section>
  );
}

function Tab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button className={`tab ${active ? 'tab-active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <span className="tab-count">{count}</span>
    </button>
  );
}

function TaskRow({
  t, task, category, categories,
  editing, editingText, dragging, dropTarget,
  moveMenuOpen, onToggleMoveMenu, onCloseMoveMenu,
  onEditStart, onEditChange, onEditCommit, onEditCancel,
  onActive, onWait, onDone, onDelete, onMoveCategory, onCycleWorkload,
  onMouseDown,
}: {
  t: Strings;
  task: Task;
  category?: Category;
  categories: Category[];
  editing: boolean;
  editingText: string;
  dragging: boolean;
  dropTarget: boolean;
  moveMenuOpen: boolean;
  onToggleMoveMenu: () => void;
  onCloseMoveMenu: () => void;
  onEditStart: () => void;
  onEditChange: (s: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onActive: () => void;
  onWait: () => void;
  onDone: () => void;
  onDelete: () => void;
  onMoveCategory: (id: string | undefined) => void;
  onCycleWorkload: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const ageDays = daysDiff(Date.now(), task.createdAt);
  const stale = task.status !== 'done' && ageDays >= 3;
  const moveRef = useClickOutside<HTMLDivElement>(moveMenuOpen, onCloseMoveMenu);

  let tail: string | null = null;
  if (task.status === 'done' && task.doneAt) {
    tail = isToday(task.doneAt) ? formatHM(task.doneAt) : formatMD(task.doneAt);
  } else if (task.status === 'waiting') {
    tail = t.rowOnHold;
  } else if (stale) {
    tail = t.rowDays(ageDays);
  }

  return (
    <div
      className={`row row-${task.status} ${stale ? 'row-stale' : ''} ${dragging ? 'row-dragging' : ''} ${dropTarget ? 'row-drop-target' : ''} ${moveMenuOpen ? 'row-menu-open' : ''}`}
      style={category ? { ['--row-color' as any]: category.color } : undefined}
      data-task-id={task.id}
      onMouseDown={onMouseDown}
    >
      <span className="row-rail" />
      {task.workload && (
        <span
          className="row-wl"
          title={`${t.workloadLabel}: ${workloadLabel(task.workload, t)}`}
        >
          {workloadEmoji(task.workload)}
        </span>
      )}
      <button
        className={`check check-${task.status}`}
        title={task.status === 'done' ? t.rowUnmarkDoneTitle : t.rowMarkDoneTitle}
        onClick={onDone}
      >
        {task.status === 'done' ? (
          <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
        ) : task.status === 'waiting' ? (
          <svg viewBox="0 0 16 16" width="9" height="9"><rect x="4" y="3" width="2.5" height="10" rx="0.6" fill="currentColor"/><rect x="9.5" y="3" width="2.5" height="10" rx="0.6" fill="currentColor"/></svg>
        ) : null}
      </button>

      <div className="row-body">
        {editing ? (
          <input
            className="row-edit"
            value={editingText}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEditCommit();
              else if (e.key === 'Escape') onEditCancel();
            }}
            onBlur={onEditCommit}
            autoFocus
          />
        ) : (
          <span className="row-text" onDoubleClick={onEditStart} title={t.rowEditTooltip}>{task.text}</span>
        )}
      </div>

      {tail && !editing && <span className="row-tail">{tail}</span>}

      <div className="row-actions">
        <button className="mini-btn" title={`${t.rowCycleWorkloadTitle} · ${workloadLabel(task.workload, t)}`} onClick={onCycleWorkload}>
          <span className="mini-emoji">{workloadEmoji(task.workload) || '🏋️'}</span>
        </button>
        <button className="mini-btn" title={t.rowEditTitle} onClick={onEditStart}>
          <svg width="11" height="11" viewBox="0 0 14 14"><path d="M2 12l1-3 6-6 2 2-6 6-3 1z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"/></svg>
        </button>
        <div className="cat-menu-wrap" ref={moveRef}>
          <button className="mini-btn" title={t.rowMoveTitle} onClick={onToggleMoveMenu}>
            <svg width="11" height="11" viewBox="0 0 14 14"><path d="M2 4h6l1.5 2H12a1 1 0 011 1v3a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1z" fill="currentColor" opacity="0.85"/></svg>
          </button>
          {moveMenuOpen && (
            <div className="popover popover-below-right">
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={`popover-item ${task.categoryId === c.id ? 'popover-item-active' : ''}`}
                  onClick={() => { onMoveCategory(c.id); onCloseMoveMenu(); }}
                >
                  <span className="popover-dot" style={{ background: c.color }} />
                  {c.name}
                </button>
              ))}
              <button
                className={`popover-item ${!task.categoryId ? 'popover-item-active' : ''}`}
                onClick={() => { onMoveCategory(undefined); onCloseMoveMenu(); }}
              >
                <span className="popover-dot popover-dot-none" />
                {t.uncategorized}
              </button>
            </div>
          )}
        </div>
        {task.status !== 'waiting' && task.status !== 'done' && (
          <button className="mini-btn" title={t.rowHoldTitle} onClick={onWait}>
            <svg width="11" height="11" viewBox="0 0 16 16"><rect x="4" y="3" width="2.5" height="10" rx="0.6" fill="currentColor"/><rect x="9.5" y="3" width="2.5" height="10" rx="0.6" fill="currentColor"/></svg>
          </button>
        )}
        {task.status === 'waiting' && (
          <button className="mini-btn" title={t.rowResumeTitle} onClick={onActive}>
            <svg width="11" height="11" viewBox="0 0 16 16"><path d="M4 3l9 5-9 5V3z" fill="currentColor"/></svg>
          </button>
        )}
        <button className="mini-btn mini-danger" title={t.rowDeleteTitle} onClick={onDelete}>
          <svg width="11" height="11" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
        </button>
      </div>
    </div>
  );
}

function SettingsPanel({
  t, locale, categories, onClose, onHide, onMinimize,
  onAdd, onRename, onCycleColor, onDelete, onSetLocale,
}: {
  t: Strings;
  locale: Locale;
  categories: Category[];
  onClose: () => void;
  onHide: () => void;
  onMinimize: () => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onCycleColor: (id: string) => void;
  onDelete: (id: string) => void;
  onSetLocale: (l: Locale) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');

  function commitEdit() {
    if (!editingId) return;
    if (editName.trim()) onRename(editingId, editName);
    setEditingId(null);
    setEditName('');
  }
  function commitAdd() {
    if (newName.trim()) {
      onAdd(newName);
      setNewName('');
    }
  }

  return (
    <div className="app">
      <header className="titlebar">
        <button className="back-btn" onClick={onClose} title={t.back}>
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span>{t.settings}</span>
        </button>
        <div className="titlebar-actions">
          <button className="ico-btn" title={t.minimize} onClick={onMinimize}>
            <svg width="13" height="13" viewBox="0 0 14 14"><rect x="2" y="6.5" width="10" height="1.2" rx="0.6" fill="currentColor"/></svg>
          </button>
          <button className="ico-btn" title={t.hide} onClick={onHide}>
            <svg width="13" height="13" viewBox="0 0 14 14"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </button>
        </div>
      </header>

      <main className="settings">
        <h3 className="settings-h">{t.settingsLanguage}</h3>
        <div className="lang-toggle">
          <button
            className={`lang-pill ${locale === 'en' ? 'lang-pill-active' : ''}`}
            onClick={() => onSetLocale('en')}
          >{t.langEN}</button>
          <button
            className={`lang-pill ${locale === 'zh' ? 'lang-pill-active' : ''}`}
            onClick={() => onSetLocale('zh')}
          >{t.langZH}</button>
        </div>

        <h3 className="settings-h">{t.settingsCategories}</h3>
        <p className="settings-hint">
          {t.settingsCategoriesHintMain}
          <br />
          {t.settingsCategoriesHintNote}
        </p>
        <div className="settings-list">
          {categories.map((c) => (
            <div key={c.id} className="settings-row">
              <button
                className="settings-color"
                style={{ background: c.color }}
                onClick={() => onCycleColor(c.id)}
                title={t.settingsCycleColorTitle}
              />
              {editingId === c.id ? (
                <input
                  className="settings-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit();
                    else if (e.key === 'Escape') { setEditingId(null); setEditName(''); }
                  }}
                  onBlur={commitEdit}
                  autoFocus
                />
              ) : (
                <span className="settings-name" onDoubleClick={() => { setEditingId(c.id); setEditName(c.name); }}>
                  {c.name}
                </span>
              )}
              <button
                className="mini-btn"
                title={t.settingsRenameTitle}
                onClick={() => { setEditingId(c.id); setEditName(c.name); }}
              >
                <svg width="11" height="11" viewBox="0 0 14 14"><path d="M2 12l1-3 6-6 2 2-6 6-3 1z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"/></svg>
              </button>
              {categories.length > 1 && (
                <button
                  className="mini-btn mini-danger"
                  title={t.rowDeleteTitle}
                  onClick={() => onDelete(c.id)}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                </button>
              )}
            </div>
          ))}
          <div className="settings-row settings-add">
            <span className="settings-color settings-color-add" />
            <input
              className="settings-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitAdd(); }}
              placeholder={t.settingsNewCatPlaceholder}
            />
            <button
              className="settings-add-btn"
              onClick={commitAdd}
              disabled={!newName.trim()}
              title={t.settingsNewCatTitle}
            >
              <svg width="11" height="11" viewBox="0 0 14 14"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        <h3 className="settings-h">{t.settingsData}</h3>
        <p className="settings-hint">
          {t.settingsDataLocationLabel}: <span className="mono">~/Library/Application Support/jobdone/jobdone.json</span>
          <br />
          {t.settingsDataBackupNote}
        </p>
      </main>
    </div>
  );
}

function formatHM(ts: number) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatMD(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
