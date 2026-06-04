import type { AppData, Task } from './types';

const STORAGE_KEY = 'jobdone:data';
const DEFAULT_FONT_SIZE = 13;
const DEFAULT_FONT_COLOR = '#f4f5fa';
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 22;

const empty: AppData = {
  tasks: [],
  settings: { alwaysOnTop: true, fontSize: DEFAULT_FONT_SIZE, fontColor: DEFAULT_FONT_COLOR },
};

function normalizeFontSize(value: unknown) {
  const size = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

function normalizeFontColor(value: unknown) {
  if (typeof value !== 'string') return DEFAULT_FONT_COLOR;
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_FONT_COLOR;
}

function normalizeTask(task: Task & { workload?: unknown; children?: unknown; status?: unknown }): Task {
  const { categoryId: _categoryId, workload: _workload, children, ...rest } = task;
  const status = rest.status === 'done' ? 'done' : 'active';
  return {
    ...rest,
    status,
    doneAt: status === 'done' ? rest.doneAt : undefined,
    pinned: Boolean(rest.pinned),
    children: Array.isArray(children) ? children.map((child) => normalizeTask(child as Task)) : [],
  } as Task;
}

function normalize(data: Partial<AppData> | null | undefined): AppData {
  const settings = { ...empty.settings, ...(data?.settings || {}) } as AppData['settings'] & {
    activeCategoryId?: string;
    filterCategoryId?: string | null;
    migratedUncategorizedToWork?: boolean;
    locale?: unknown;
  };
  const tasks = (data?.tasks || []).map((task) => normalizeTask(task as Task));

  settings.fontSize = normalizeFontSize(settings.fontSize);
  settings.fontColor = normalizeFontColor(settings.fontColor);

  delete settings.activeCategoryId;
  delete settings.filterCategoryId;
  delete settings.migratedUncategorizedToWork;
  delete settings.locale;

  return { tasks, settings };
}

export async function loadData(): Promise<AppData> {
  if (window.jobdone) {
    try {
      const data = await window.jobdone.read();
      return normalize(data);
    } catch {
      return normalize(null);
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalize(null);
    return normalize(JSON.parse(raw) as AppData);
  } catch {
    return normalize(null);
  }
}

export async function saveData(data: AppData): Promise<void> {
  if (window.jobdone) {
    await window.jobdone.write(data);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
