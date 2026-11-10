export type Tag = { id: string; name: string; count?: number };
export type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  count: number;
};
export type Preferences = {
  backupDir: string;
  theme: "light" | "dark" | "system";
  editorFontSize: number;
  autosaveDelay: number;
};
export type Item = {
  id: string;
  folder_id: string | null;
  kind: "note" | "pdf" | "image" | "epub" | "word";
  private: number;
  title: string;
  html: string;
  plain: string;
  document_json: string | null;
  asset: string | null;
  favorite: number;
  created_at: string;
  updated_at: string;
  opened_at: string | null;
  deleted_at: string | null;
  index_status: string;
  index_error: string;
  tags: Tag[];
  preview?: string;
  hit_page?: number | null;
};
export type Filters = {
  view: string;
  tags: string[];
  query: string;
  kind: string;
  sort: string;
  favorite: boolean;
  limit?: number;
  folderId?: string | null;
};
export type ListResult = {
  items: Item[];
  total: number;
  tags: Tag[];
  folders: Folder[];
  stats: {
    total: number;
    notes: number;
    pdfs: number;
    images: number;
    trash: number;
  };
};
export type Info = {
  root: string;
  backupDir: string;
  version: string;
  warning: string;
  preferences: Preferences;
};
declare global {
  interface Window {
    knowledge: {
      call: <T = any>(action: string, payload?: any) => Promise<T>;
      droppedPaths: (files: File[]) => string[];
      onClose: (callback: () => void) => () => void;
    };
  }
}
