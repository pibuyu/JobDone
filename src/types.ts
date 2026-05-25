export type TaskStatus = 'active' | 'waiting' | 'done';
export type Workload = 'S' | 'M' | 'L';

export interface Task {
  id: string;
  text: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  doneAt?: number;
  note?: string;
  categoryId?: string;
  workload?: Workload;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

export type Locale = 'en' | 'zh';

export interface Settings {
  alwaysOnTop?: boolean;
  activeCategoryId?: string;
  // Category filter for the main list view (null/undefined = show all).
  filterCategoryId?: string | null;
  locale?: Locale;
  // One-time flag: pre-categories tasks (where categoryId was undefined)
  // get auto-assigned to the first category once.
  migratedUncategorizedToWork?: boolean;
}

export interface AppData {
  tasks: Task[];
  categories: Category[];
  settings: Settings;
}

declare global {
  interface Window {
    jobdone?: {
      read: () => Promise<AppData>;
      write: (data: AppData) => Promise<boolean>;
      hide: () => Promise<void>;
      minimize: () => Promise<void>;
      setAlwaysOnTop: (flag: boolean) => Promise<boolean>;
    };
  }
}
