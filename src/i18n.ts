export interface Strings {
  brand: string;
  settings: string;
  back: string;
  minimize: string;
  hide: string;
  placeholders: string[];
  add: string;
  tabActive: string;
  tabDone: string;
  emptyDone: string;
  emptyActive: string;
  footerToday: string;
  footerActive: string;
  clearDone: string;
  rowDays: (n: number) => string;
  rowDeleteTitle: string;
  rowMarkDoneTitle: string;
  rowUnmarkDoneTitle: string;
  rowEditTooltip: string;
  rowAddChildTitle: string;
  rowPinTitle: string;
  rowUnpinTitle: string;
  rowPinnedLabel: string;
  childPlaceholder: string;
  settingsAppearance: string;
  fontSize: string;
  fontColor: string;
  fontSizeUnit: string;
}

export const STRINGS: Strings = {
  brand: 'JobDone',
  settings: '设置',
  back: '返回',
  minimize: '最小化',
  hide: '隐藏到托盘',
  placeholders: [
    '想做点什么？',
    '一件小事，写下来吧。',
    '这次想搞定什么？',
    '别犹豫，先写下来。',
    '今天的下一步是...',
  ],
  add: '加',
  tabActive: '进行',
  tabDone: '完成',
  emptyDone: '还没完成，去搞定一个。',
  emptyActive: '空空如也，写下一件事吧。',
  footerToday: '今',
  footerActive: '行',
  clearDone: '清空已完成',
  rowDays: (n) => `${n}天`,
  rowDeleteTitle: '删除',
  rowMarkDoneTitle: '标记已完成',
  rowUnmarkDoneTitle: '取消完成',
  rowEditTooltip: '双击编辑，拖动可调整顺序',
  rowAddChildTitle: '添加子待办',
  rowPinTitle: '置顶',
  rowUnpinTitle: '取消置顶',
  rowPinnedLabel: '已置顶',
  childPlaceholder: '输入子待办...',
  settingsAppearance: '外观',
  fontSize: '字体大小',
  fontColor: '字体颜色',
  fontSizeUnit: 'px',
};
