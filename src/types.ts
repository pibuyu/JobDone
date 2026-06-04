export type TaskStatus = 'active' | 'done';

export interface Task {
  id: string;
  text: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  doneAt?: number;
  note?: string;
  pinned?: boolean;
  children?: Task[];
  // Legacy field from the category build. New writes strip it out.
  categoryId?: string;
}

export interface Settings {
  alwaysOnTop?: boolean;
  fontSize?: number;
  fontColor?: string;
}

export interface AppData {
  tasks: Task[];
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
      setCompactHeight: (height: number) => Promise<boolean>;
      restoreExpandedHeight: () => Promise<boolean>;
      openExternal: (href: string) => Promise<boolean>;
    };
  }
}
