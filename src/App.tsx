import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { AppData, Task, TaskStatus } from './types';
import { loadData, saveData, uid } from './store';
import { STRINGS, type Strings } from './i18n';
import { Confetti } from './confetti';

type FilterTab = 'active' | 'done';

const DEFAULT_FONT_SIZE = 13;
const DEFAULT_FONT_COLOR = '#f4f5fa';
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 22;
const COLOR_PRESETS = ['#f4f5fa', '#ffffff', '#d8f7ff', '#c7f7d4', '#ffe6a7', '#ffc7d6'];
const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const TRAILING_URL_PUNCTUATION = /[.,;:!?，。；：！？、]+$/;
const COMPACT_MAX_VISIBLE_ROWS = 9;
const COMPACT_TITLEBAR_HEIGHT = 30;
const COMPACT_VERTICAL_PADDING = 14;
const COMPACT_EMPTY_VERTICAL_PADDING = 30;

type TextPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

function clampFontSize(value: unknown) {
  const size = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

function normalizeFontColor(value: unknown) {
  if (typeof value !== 'string') return DEFAULT_FONT_COLOR;
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_FONT_COLOR;
}

function getAppStyle(settings: AppData['settings']): CSSProperties {
  return {
    ['--user-font-size' as string]: `${clampFontSize(settings.fontSize)}px`,
    ['--text' as string]: normalizeFontColor(settings.fontColor),
  } as CSSProperties;
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

function shouldCommitEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  const native = e.nativeEvent as KeyboardEvent;
  return e.key === 'Enter' && !native.isComposing && !(e as any).isComposing && e.keyCode !== 229;
}

function toExternalHref(raw: string) {
  const href = raw.toLowerCase().startsWith('www.') ? `https://${raw}` : raw;
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function splitTextLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const rawMatch = match[0];
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: 'text', text: text.slice(cursor, index) });

    const trailing = rawMatch.match(TRAILING_URL_PUNCTUATION)?.[0] || '';
    const urlText = trailing ? rawMatch.slice(0, -trailing.length) : rawMatch;
    const href = toExternalHref(urlText);
    if (href) parts.push({ kind: 'link', text: urlText, href });
    else parts.push({ kind: 'text', text: urlText });
    if (trailing) parts.push({ kind: 'text', text: trailing });
    cursor = index + rawMatch.length;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts.length ? parts : [{ kind: 'text', text }];
}

function openExternalLink(href: string) {
  if (window.jobdone?.openExternal) {
    window.jobdone.openExternal(href);
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}

function compareTasks(a: Task, b: Task) {
  const ap = Boolean(a.pinned);
  const bp = Boolean(b.pinned);
  if (ap !== bp) return ap ? -1 : 1;
  const order = (s: TaskStatus) => (s === 'active' ? 0 : 1);
  const so = order(a.status) - order(b.status);
  if (so !== 0) return so;
  if (a.status === 'done' && b.status === 'done') return (b.doneAt || 0) - (a.doneAt || 0);
  return 0;
}

function sortTaskTree(tasks: Task[]): Task[] {
  return [...tasks].sort(compareTasks).map((task) => ({
    ...task,
    children: sortTaskTree(task.children || []),
  }));
}

function matchesFilter(task: Task, filter: FilterTab) {
  return task.status === filter;
}

function filterTaskTree(tasks: Task[], filter: FilterTab): Task[] {
  return sortTaskTree(tasks).filter((task) => matchesFilter(task, filter));
}

function countRootTasks(tasks: Task[]) {
  const counts = { active: 0, done: 0, doneToday: 0, total: 0 };
  for (const task of tasks) {
    counts.total += 1;
    counts[task.status] += 1;
    if (task.status === 'done' && task.doneAt && isToday(task.doneAt)) counts.doneToday += 1;
  }
  return counts;
}

function countVisibleTaskRows(tasks: Task[]) {
  let rows = 0;
  const visit = (taskList: Task[]) => {
    for (const task of taskList) {
      rows += 1;
      visit(task.children || []);
    }
  };
  visit(tasks);
  return rows;
}

function findTaskById(tasks: Task[], id: string): Task | null {
  for (const task of tasks) {
    if (task.id === id) return task;
    const child = findTaskById(task.children || [], id);
    if (child) return child;
  }
  return null;
}

function updateTaskTree(tasks: Task[], id: string, updater: (task: Task) => Task): Task[] {
  return tasks.map((task) => {
    if (task.id === id) return updater(task);
    return { ...task, children: updateTaskTree(task.children || [], id, updater) };
  });
}

function removeTaskFromTree(tasks: Task[], id: string): Task[] {
  return tasks
    .filter((task) => task.id !== id)
    .map((task) => ({ ...task, children: removeTaskFromTree(task.children || [], id) }));
}

function addChildToTree(tasks: Task[], parentId: string, child: Task): Task[] {
  return tasks.map((task) => {
    if (task.id === parentId) {
      return { ...task, children: [child, ...(task.children || [])], updatedAt: Date.now() };
    }
    return { ...task, children: addChildToTree(task.children || [], parentId, child) };
  });
}

function completeTaskTree(task: Task, completedAt: number): Task {
  return {
    ...task,
    status: 'done',
    doneAt: task.status === 'done' && task.doneAt ? task.doneAt : completedAt,
    updatedAt: completedAt,
    children: (task.children || []).map((child) => completeTaskTree(child, completedAt)),
  };
}

function clearDoneFromTree(tasks: Task[]): Task[] {
  return tasks
    .filter((task) => task.status !== 'done')
    .map((task) => ({ ...task, children: task.children || [] }));
}

function reorderTaskTree(tasks: Task[], sourceId: string, targetId: string): Task[] {
  const sourceIdx = tasks.findIndex((task) => task.id === sourceId);
  const targetIdx = tasks.findIndex((task) => task.id === targetId);
  if (sourceIdx >= 0 && targetIdx >= 0) {
    const reordered = [...tasks];
    const [moved] = reordered.splice(sourceIdx, 1);
    const newTargetIdx = reordered.findIndex((task) => task.id === targetId);
    reordered.splice(newTargetIdx, 0, moved);
    return reordered;
  }
  return tasks.map((task) => ({
    ...task,
    children: reorderTaskTree(task.children || [], sourceId, targetId),
  }));
}

export default function App() {
  const [data, setData] = useState<AppData>({
    tasks: [],
    settings: { alwaysOnTop: true, fontSize: DEFAULT_FONT_SIZE, fontColor: DEFAULT_FONT_COLOR },
  });
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('active');
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [controlsExpanded, setControlsExpanded] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [confettiTick, setConfettiTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pointer-based drag state — refs so the document-level listener reads
  // current values without re-binding on every render.
  const dragStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  const dropTargetIdRef = useRef<string | null>(null);
  draggedIdRef.current = draggedId;
  dropTargetIdRef.current = dropTargetId;

  // Cursor position during an active drag, for the floating ghost preview.
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);

  const t: Strings = STRINGS;
  const appStyle = getAppStyle(data.settings);
  const placeholder = useMemo(
    () => t.placeholders[Math.floor(Math.random() * t.placeholders.length)],
    [t]
  );

  useEffect(() => {
    loadData().then((d) => {
      setData(d);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    function onBlur() {
      setControlsExpanded(false);
      setShowSettings(false);
    }
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveData(data);
  }, [data, loaded]);

  const tasks = data.tasks;

  const counts = useMemo(() => countRootTasks(tasks), [tasks]);

  const visible = useMemo(() => filterTaskTree(tasks, filter), [tasks, filter]);
  const visibleRows = useMemo(() => countVisibleTaskRows(visible), [visible]);

  useEffect(() => {
    if (showSettings || !loaded) return;
    if (controlsExpanded) {
      window.jobdone?.restoreExpandedHeight?.();
      return;
    }
    const fontSize = clampFontSize(data.settings.fontSize);
    if (visibleRows === 0) {
      window.jobdone?.setCompactHeight?.(
        COMPACT_TITLEBAR_HEIGHT + Math.ceil(fontSize * 1.55) + COMPACT_EMPTY_VERTICAL_PADDING
      );
      return;
    }
    const rows = Math.min(COMPACT_MAX_VISIBLE_ROWS, visibleRows);
    const rowHeight = fontSize + 17;
    window.jobdone?.setCompactHeight?.(
      rows * rowHeight + COMPACT_TITLEBAR_HEIGHT + COMPACT_VERTICAL_PADDING
    );
  }, [controlsExpanded, data.settings.fontSize, loaded, showSettings, visibleRows]);

  function addTask() {
    const text = draft.trim();
    if (!text) return;
    const task: Task = {
      id: uid(),
      text,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      children: [],
    };
    setData((d) => ({ ...d, tasks: [task, ...d.tasks] }));
    setDraft('');
  }

  function addChildTask(parentId: string) {
    const child: Task = {
      id: uid(),
      text: '',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      children: [],
    };
    setData((d) => ({ ...d, tasks: addChildToTree(d.tasks, parentId, child) }));
    setEditingId(child.id);
    setEditingText('');
  }

  function togglePinned(id: string) {
    setData((d) => ({
      ...d,
      tasks: updateTaskTree(d.tasks, id, (task) => ({
        ...task,
        pinned: !task.pinned,
        updatedAt: Date.now(),
      })),
    }));
  }

  function toggleDone(id: string) {
    const target = findTaskById(tasks, id);
    const completing = Boolean(target && target.status !== 'done');
    const now = Date.now();
    setData((d) => ({
      ...d,
      tasks: updateTaskTree(d.tasks, id, (task) => {
        const done = task.status !== 'done';
        if (done) return completeTaskTree(task, now);
        return {
          ...task,
          status: 'active',
          doneAt: undefined,
          updatedAt: now,
        };
      }),
    }));
    if (completing) setConfettiTick((n) => n + 1);
  }

  function reorderTasks(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setData((d) => ({ ...d, tasks: reorderTaskTree(d.tasks, sourceId, targetId) }));
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
    if (!controlsExpanded) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a')) return;
    if (editingId === taskId) return;
    if (e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, id: taskId };
  }

  function removeTask(id: string) {
    setData((d) => ({ ...d, tasks: removeTaskFromTree(d.tasks, id) }));
  }

  function clearDone() {
    setData((d) => ({ ...d, tasks: clearDoneFromTree(d.tasks) }));
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
        tasks: updateTaskTree(d.tasks, id, (task) => ({ ...task, text, updatedAt: Date.now() })),
      }));
    }
    setEditingId(null);
    setEditingText('');
  }

  function cancelEdit() {
    if (editingId && !editingText.trim()) removeTask(editingId);
    setEditingId(null);
    setEditingText('');
  }

  function setFontSize(next: number) {
    setData((d) => ({ ...d, settings: { ...d.settings, fontSize: clampFontSize(next) } }));
  }

  function setFontColor(next: string) {
    setData((d) => ({ ...d, settings: { ...d.settings, fontColor: normalizeFontColor(next) } }));
  }

  function expandFromCompact(e: React.MouseEvent<HTMLDivElement>) {
    if (controlsExpanded) return;
    const target = e.target as HTMLElement;
    if (target.closest('.titlebar')) return;
    setControlsExpanded(true);
  }

  if (showSettings) {
    return (
      <SettingsPanel
        t={t}
        settings={data.settings}
        appStyle={appStyle}
        onClose={() => setShowSettings(false)}
        onHide={() => window.jobdone?.hide()}
        onMinimize={() => window.jobdone?.minimize()}
        onSetFontSize={setFontSize}
        onSetFontColor={setFontColor}
      />
    );
  }

  const showControls = controlsExpanded;
  const isEmpty = visible.length === 0;

  const draggedTaskText = draggedId
    ? findTaskById(tasks, draggedId)?.text
    : null;

  return (
    <div
      className={`app ${showControls ? '' : 'app-unfocused'} ${isEmpty ? 'app-empty' : ''} ${draggedId ? 'app-dragging' : ''}`}
      style={appStyle}
      onClick={expandFromCompact}
    >
      <Confetti tick={confettiTick} />

      {draggedTaskText && dragCursor && (
        <div
          className="drag-ghost"
          style={{ left: dragCursor.x + 12, top: dragCursor.y - 8 }}
        >
          {draggedTaskText}
        </div>
      )}

      <header className={`titlebar ${showControls ? '' : 'titlebar-compact'}`}>
        <div className="brand">
          <span className="dot" />
          <span className="brand-label">{t.brand}</span>
        </div>
        {showControls && (
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
        )}
      </header>

      {showControls && (
        <ComposerRow
          t={t}
          draft={draft}
          setDraft={setDraft}
          onSubmit={addTask}
          placeholder={placeholder}
          inputRef={inputRef}
        />
      )}

      {showControls && (
        <nav className="tabs">
          <Tab label={t.tabActive} count={counts.active} active={filter === 'active'} onClick={() => setFilter('active')} />
          <Tab label={t.tabDone} count={counts.done} active={filter === 'done'} onClick={() => setFilter('done')} />
        </nav>
      )}

      <main className="list">
        {visible.length === 0 ? (
          <div className="empty">
            {filter === 'done' ? t.emptyDone :
             t.emptyActive}
          </div>
        ) : (
          visible.map((task) => (
            <TaskNode
              key={task.id}
              t={t}
              task={task}
              editingId={editingId}
              editingText={editingText}
              draggedId={draggedId}
              dropTargetId={dropTargetId}
              onEditStart={startEdit}
              onEditChange={setEditingText}
              onEditCommit={commitEdit}
              onEditCancel={cancelEdit}
              onAddChild={addChildTask}
              onDelete={removeTask}
              onToggleDone={toggleDone}
              onTogglePinned={togglePinned}
              onMouseDown={startRowDrag}
            />
          ))
        )}
      </main>

      {showControls && (
        <footer className="foot">
          <span className="foot-text">
            {t.footerToday} <strong>{counts.doneToday}</strong> · {t.footerActive} <strong>{counts.active}</strong>
          </span>
          {counts.done > 0 && (
            <button className="link-btn" onClick={clearDone}>{t.clearDone}</button>
          )}
        </footer>
      )}
    </div>
  );
}

function ComposerRow({
  t, draft, setDraft, onSubmit, placeholder, inputRef,
}: {
  t: Strings;
  draft: string;
  setDraft: (s: string) => void;
  onSubmit: () => void;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <section className="composer">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (shouldCommitEnter(e)) {
            e.preventDefault();
            onSubmit();
          }
        }}
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

function TaskNode({
  t, task,
  editingId, editingText, draggedId, dropTargetId,
  onEditStart, onEditChange, onEditCommit, onEditCancel,
  onAddChild, onDelete, onToggleDone, onTogglePinned, onMouseDown,
}: {
  t: Strings;
  task: Task;
  editingId: string | null;
  editingText: string;
  draggedId: string | null;
  dropTargetId: string | null;
  onEditStart: (task: Task) => void;
  onEditChange: (s: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onAddChild: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleDone: (id: string) => void;
  onTogglePinned: (id: string) => void;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
}) {
  const children = task.children || [];
  return (
    <div className="task-node">
      <TaskRow
        t={t}
        task={task}
        editing={editingId === task.id}
        editingText={editingText}
        dragging={draggedId === task.id}
        dropTarget={dropTargetId === task.id && draggedId !== task.id}
        onEditStart={() => onEditStart(task)}
        onEditChange={onEditChange}
        onEditCommit={onEditCommit}
        onEditCancel={onEditCancel}
        onAddChild={() => onAddChild(task.id)}
        onDelete={() => onDelete(task.id)}
        onToggleDone={() => onToggleDone(task.id)}
        onTogglePinned={() => onTogglePinned(task.id)}
        onMouseDown={(e) => onMouseDown(task.id, e)}
      />
      {children.length > 0 && (
        <div className="task-children">
          {children.map((child) => (
            <TaskNode
              key={child.id}
              t={t}
              task={child}
              editingId={editingId}
              editingText={editingText}
              draggedId={draggedId}
              dropTargetId={dropTargetId}
              onEditStart={onEditStart}
              onEditChange={onEditChange}
              onEditCommit={onEditCommit}
              onEditCancel={onEditCancel}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onToggleDone={onToggleDone}
              onTogglePinned={onTogglePinned}
              onMouseDown={onMouseDown}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  t, task,
  editing, editingText, dragging, dropTarget,
  onEditStart, onEditChange, onEditCommit, onEditCancel,
  onAddChild, onDelete, onToggleDone, onTogglePinned,
  onMouseDown,
}: {
  t: Strings;
  task: Task;
  editing: boolean;
  editingText: string;
  dragging: boolean;
  dropTarget: boolean;
  onEditStart: () => void;
  onEditChange: (s: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  onToggleDone: () => void;
  onTogglePinned: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const ageDays = daysDiff(Date.now(), task.createdAt);
  const stale = task.status !== 'done' && ageDays >= 3;

  let tail: string | null = null;
  if (task.status === 'done' && task.doneAt) {
    tail = isToday(task.doneAt) ? formatHM(task.doneAt) : formatMD(task.doneAt);
  } else if (stale) {
    tail = t.rowDays(ageDays);
  }

  return (
    <div
      className={`row row-${task.status} ${task.pinned ? 'row-pinned' : ''} ${stale ? 'row-stale' : ''} ${dragging ? 'row-dragging' : ''} ${dropTarget ? 'row-drop-target' : ''}`}
      data-task-id={task.id}
      onMouseDown={onMouseDown}
    >
      <span className="row-rail" />
      <button
        className={`check ${task.status === 'done' ? 'check-done' : ''}`}
        title={task.status === 'done' ? t.rowUnmarkDoneTitle : t.rowMarkDoneTitle}
        onClick={onToggleDone}
      >
        {task.status === 'done' && (
          <svg viewBox="0 0 16 16" width="12" height="12">
            <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        )}
      </button>

      <div className="row-body">
        {editing ? (
          <input
            className="row-edit"
            value={editingText}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (shouldCommitEnter(e)) {
                e.preventDefault();
                onEditCommit();
              }
              else if (e.key === 'Escape') onEditCancel();
            }}
            onBlur={onEditCommit}
            placeholder={t.childPlaceholder}
            autoFocus
          />
        ) : (
          <TaskText text={task.text} onEditStart={onEditStart} title={t.rowEditTooltip} />
        )}
      </div>

      {tail && !editing && <span className="row-tail">{tail}</span>}

      <div className="row-actions">
        <button className="mini-btn" title={t.rowAddChildTitle} onClick={onAddChild}>
          <svg width="11" height="11" viewBox="0 0 16 16">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
        <button
          className={`mini-btn ${task.pinned ? 'mini-pin-active' : ''}`}
          title={task.pinned ? t.rowUnpinTitle : t.rowPinTitle}
          onClick={onTogglePinned}
        >
          <svg width="11" height="11" viewBox="0 0 16 16">
            <path d="M6.2 1.8h7l-2.1 2.1 1.5 3.6 2.1 2.1H9.9L8 14.2 6.1 9.6H1.3l2.1-2.1 1.5-3.6-2.1-2.1h3.4z" stroke="currentColor" strokeWidth="1.1" fill={task.pinned ? 'currentColor' : 'none'} strokeLinejoin="round"/>
          </svg>
        </button>
        <button className="mini-btn mini-danger" title={t.rowDeleteTitle} onClick={onDelete}>
          <svg width="11" height="11" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
        </button>
      </div>
    </div>
  );
}

function TaskText({ text, onEditStart, title }: { text: string; onEditStart: () => void; title: string }) {
  const parts = useMemo(() => splitTextLinks(text), [text]);
  return (
    <span className="row-text" onDoubleClick={onEditStart} title={title}>
      {parts.map((part, index) => {
        if (part.kind === 'text') return <span key={index}>{part.text}</span>;
        return (
          <a
            key={index}
            className="row-link"
            href={part.href}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openExternalLink(part.href);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title={part.href}
          >
            {part.text}
          </a>
        );
      })}
    </span>
  );
}

function SettingsPanel({
  t, settings, appStyle, onClose, onHide, onMinimize, onSetFontSize, onSetFontColor,
}: {
  t: Strings;
  settings: AppData['settings'];
  appStyle: CSSProperties;
  onClose: () => void;
  onHide: () => void;
  onMinimize: () => void;
  onSetFontSize: (size: number) => void;
  onSetFontColor: (color: string) => void;
}) {
  const fontSize = clampFontSize(settings.fontSize);
  const fontColor = normalizeFontColor(settings.fontColor);

  return (
    <div className="app" style={appStyle}>
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
        <h3 className="settings-h">{t.settingsAppearance}</h3>

        <div className="setting-control">
          <label className="setting-label" htmlFor="font-size">{t.fontSize}</label>
          <div className="range-row">
            <input
              id="font-size"
              className="range-input"
              type="range"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              step={1}
              value={fontSize}
              onChange={(e) => onSetFontSize(Number(e.currentTarget.value))}
            />
            <span className="setting-value">{fontSize}{t.fontSizeUnit}</span>
          </div>
        </div>

        <div className="setting-control">
          <label className="setting-label" htmlFor="font-color">{t.fontColor}</label>
          <div className="color-row">
            <input
              id="font-color"
              className="color-input"
              type="color"
              value={fontColor}
              onChange={(e) => onSetFontColor(e.currentTarget.value)}
              title={t.fontColor}
            />
            <div className="swatches">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  className={`swatch ${fontColor.toLowerCase() === color ? 'swatch-active' : ''}`}
                  style={{ backgroundColor: color }}
                  title={color}
                  aria-label={`${t.fontColor} ${color}`}
                  onClick={() => onSetFontColor(color)}
                />
              ))}
            </div>
          </div>
        </div>
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
