export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

export const QuickPickItemKind = {
  Separator: -1,
  Default: 0,
};

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3,
};

export class ThemeIcon {
  constructor(public readonly id: string, public readonly color?: any) {}
}

export class TreeItem {
  public description?: string;
  public tooltip?: string;
  public iconPath?: any;
  public contextValue?: string;
  public command?: any;
  constructor(public label: string, public collapsibleState?: number) {}
}

export class EventEmitter<T = any> {
  private listeners: Array<(e: T) => void> = [];
  public event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  public fire(data?: T): void {
    for (const l of this.listeners) l(data as T);
  }
  public dispose(): void {
    this.listeners = [];
  }
}

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;
  constructor(start: Position | number, end: Position | number, endLine?: number, endChar?: number) {
    if (typeof start === "number" && typeof end === "number") {
      this.start = new Position(start, end);
      this.end = new Position(endLine ?? start, endChar ?? end);
    } else {
      this.start = start as Position;
      this.end = end as Position;
    }
  }
}

export class Selection {
  public readonly active: Position;
  constructor(public readonly anchor: Position, active: Position) {
    this.active = active;
  }
}

const configMap = new Map<string, any>();

export const __mockState = {
  activeTextEditor: undefined as any,
  workspaceFolders: [] as any[],
  quickPickHandler: undefined as ((items: any[]) => any) | undefined,
  statusBarMessages: [] as string[],
  sentTerminalCommands: [] as string[],
  configMap,
};

export const workspace = {
  get workspaceFolders() {
    return __mockState.workspaceFolders;
  },
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T => {
      const fullKey = section ? `${section}.${key}` : key;
      if (configMap.has(fullKey)) return configMap.get(fullKey) as T;
      return defaultValue as T;
    },
  }),
  createFileSystemWatcher: () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
};

export const window = {
  get activeTextEditor() {
    return __mockState.activeTextEditor;
  },
  createStatusBarItem: () => ({
    text: "",
    tooltip: "",
    command: "",
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  createTerminal: () => ({
    exitStatus: undefined,
    show: () => {},
    sendText: (cmd: string) => {
      __mockState.sentTerminalCommands.push(cmd);
    },
    dispose: () => {},
  }),
  showQuickPick: async (items: any[]) => {
    return __mockState.quickPickHandler ? __mockState.quickPickHandler(items) : undefined;
  },
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showInputBox: async () => undefined,
  setStatusBarMessage: (msg: string) => {
    __mockState.statusBarMessages.push(msg);
  },
};
