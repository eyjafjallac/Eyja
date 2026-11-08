// Shapes returned by the Rust commands, shared by the library, editor and memo windows.

export type DocumentKind = "note" | "memo";

export type DocumentSummary = {
  id: string;
  kind: DocumentKind;
  title: string;
  preview: string;
  color: string | null;
  folderId: string | null;
  pinned: boolean;
  favorite: boolean;
  coverPath: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

export type Note = {
  id: string;
  kind: DocumentKind;
  title: string;
  body: string;
  color: string | null;
  folderId: string | null;
  pinned: boolean;
  favorite: boolean;
  coverAssetId: string | null;
  tags: string[];
  updatedAt: number;
};

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
};

export type TagCount = {
  name: string;
  count: number;
};

export type SearchMode = "keyword" | "similar" | "hybrid";

export type SearchHit = {
  id: string;
  score: number;
  snippet: string;
};

export type WindowSize = "small" | "medium" | "large";
export type HistoryRetention = "all" | "daily";

export type Settings = {
  memoShortcut: string;
  memoShortcutActive: boolean;
  memoRetentionDays: number | null;
  memoSize: WindowSize;
  mainSize: WindowSize;
  historyIdleMinutes: number;
  historyTypingMinutes: number;
  historyRetention: HistoryRetention;
  maxTags: number;
};

export const DEFAULT_IDLE_MINUTES = 2;
export const DEFAULT_TYPING_MINUTES = 5;
export const DEFAULT_MAX_TAGS = 5;

export function displayTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled";
}

/** Minutes between UTC and local time, as the backend expects for "per day" rules. */
export function tzOffsetMinutes() {
  return new Date().getTimezoneOffset();
}

/** Folder names from the top level down to `id`. */
export function folderPath(folders: Folder[], id: string | null) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let cursor = id ? byId.get(id) : undefined;
  while (cursor && names.length < 64) {
    names.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return names;
}

/** `id` and every folder inside it. */
export function folderAndDescendants(folders: Folder[], id: string) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Folders in tree order, each with its depth, for indented lists. */
export function folderTree(folders: Folder[]) {
  const children = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  const rows: { folder: Folder; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const folder of children.get(parent) ?? []) {
      rows.push({ folder, depth });
      if (depth < 32) visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}
