import { useState } from "react";
import { ChevronRight, Folder as FolderIcon, FolderOpen } from "lucide-react";
import type { Folder } from "./types";
type Props = {
  folders: Folder[];
  selected: string | null;
  onSelect: (id: string) => void;
  onContext: (event: React.MouseEvent, folder: Folder) => void;
};
export default function FolderTree({
  folders,
  selected,
  onSelect,
  onContext,
}: Props) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const render = (
    parent: string | null,
    ancestors: Set<string>,
    depth = 0,
  ): React.ReactNode =>
    folders
      .filter((f) => f.parent_id === parent && !ancestors.has(f.id))
      .map((folder) => {
        const children = folders.some((f) => f.parent_id === folder.id),
          open = !collapsed.includes(folder.id),
          Icon = selected === folder.id ? FolderOpen : FolderIcon;
        return (
          <div key={folder.id}>
            <div
              className={
                "folder-tree-row " + (selected === folder.id ? "active" : "")
              }
              style={{ paddingLeft: 7 + Math.min(depth, 7) * 12 }}
              onContextMenu={(e) => onContext(e, folder)}
            >
              <button
                title={open ? "折叠文件夹" : "展开文件夹"}
                className={"folder-toggle " + (open ? "open" : "")}
                disabled={!children}
                onClick={() =>
                  setCollapsed((values) =>
                    open
                      ? [...values, folder.id]
                      : values.filter((id) => id !== folder.id),
                  )
                }
              >
                <ChevronRight size={12} />
              </button>
              <button
                className="folder-select"
                title={folder.name}
                onClick={() => onSelect(folder.id)}
              >
                <Icon size={15} />
                <span>{folder.name}</span>
                <small>{folder.count}</small>
              </button>
            </div>
            {open &&
              render(folder.id, new Set([...ancestors, folder.id]), depth + 1)}
          </div>
        );
      });
  return (
    <div className="folder-tree">
      {render(null, new Set())}
      {!folders.length && <p className="tag-hint">右键资料区，新建文件夹。</p>}
    </div>
  );
}
export function folderPath(folders: Folder[], id: string | null): string {
  const names: string[] = [],
    seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find((f) => f.id === id);
    if (!folder) break;
    names.unshift(folder.name);
    id = folder.parent_id;
  }
  return names.join(" / ");
}
