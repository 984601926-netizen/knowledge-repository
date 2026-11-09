import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpen,
  Library,
  Clock3,
  Star,
  Tags,
  Trash2,
  Plus,
  Search,
  Upload,
  Settings,
  Hash,
  X,
  FileText,
  File,
  Image as ImageIcon,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  RotateCcw,
  Check,
  LoaderCircle,
  AlertCircle,
  ArrowUpRight,
  FolderOpen,
  HelpCircle,
  MoreHorizontal,
  FolderPlus,
  Folder as FolderIcon,
  ChevronLeft,
  MoveRight,
} from "lucide-react";
import Editor from "./Editor";
import PdfReader from "./PdfReader";
import SettingsPanel from "./SettingsPanel";
import FolderTree, { folderPath } from "./FolderTree";
import type { Filters, Info, Item, ListResult, Tag, Folder } from "./types";

const api = window.knowledge;
const navs = [
  { id: "all", label: "全部资料", icon: Library },
  { id: "recent", label: "最近打开", icon: Clock3 },
  { id: "favorites", label: "我的收藏", icon: Star },
  { id: "untagged", label: "未打标签", icon: Tags },
  { id: "trash", label: "回收站", icon: Trash2 },
];
const kinds = { note: "笔记", pdf: "PDF", image: "图片" };
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
type Draft = {
  id: string;
  title: string;
  html: string;
  document_json: unknown;
  revision: number;
  time: number;
};
type Modal = { title: string; content: ReactNode } | null;
function TypeIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const Icon = kind === "note" ? FileText : kind === "pdf" ? File : ImageIcon;
  return <Icon size={size} />;
}
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  return index < 0 ? (
    <>{text}</>
  ) : (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + q.length)}</mark>
      {text.slice(index + q.length)}
    </>
  );
}
export default function App() {
  const [info, setInfo] = useState<Info | null>(null),
    [result, setResult] = useState<ListResult>({
      items: [],
      total: 0,
      tags: [],
      folders: [],
      stats: { total: 0, notes: 0, pdfs: 0, images: 0, trash: 0 },
    });
  const [filters, setFilters] = useState<Filters>({
    view: "all",
    query: "",
    tags: [],
    kind: "",
    sort: "updated",
    favorite: false,
    folderId: null,
  });
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Item | null>(null),
    [status, setStatus] = useState("saved"),
    [modal, setModal] = useState<Modal>(null),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [tagPicker, setTagPicker] = useState(false),
    [focusMode, setFocusMode] = useState(false),
    [epoch, setEpoch] = useState(0),
    [drag, setDrag] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      folder?: Folder;
      item?: Item;
    } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(
      Number(localStorage.getItem("sidebarWidth")) || 226,
    ),
    [listWidth, setListWidth] = useState(
      Number(localStorage.getItem("listWidth")) || 330,
    );
  const [transitioning, setTransitioning] = useState(false),
    transitionLock = useRef(false);
  const draft = useRef<Draft | null>(null),
    revision = useRef(0),
    savePromise = useRef<Promise<boolean> | null>(null),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    current = useRef<Item | null>(null),
    infoRef = useRef<Info | null>(null),
    requestVersion = useRef(0),
    searchRef = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  current.current = selected;
  infoRef.current = info;
  useEffect(() => {
    const preferences = info?.preferences;
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences?.theme === "dark" ||
        (preferences?.theme === "system" && system.matches)
          ? "dark"
          : "light";
      document.documentElement.style.setProperty(
        "--editor-font-size",
        (preferences?.editorFontSize || 14) + "px",
      );
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [info?.preferences]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    const fit = () => {
      setListWidth((width) =>
        Math.max(270, Math.min(width, window.innerWidth - sidebarWidth - 382)),
      );
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [sidebarWidth]);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6000);
  }, []);
  const draftKey = (id: string) =>
    "shizhi-draft:" + infoRef.current?.root + ":" + id;
  const refresh = useCallback(async () => {
    const sequence = ++requestVersion.current;
    try {
      const data = await api.call<ListResult>("list", filters);
      if (sequence === requestVersion.current) setResult(data);
    } catch (e: any) {
      notify(e.message);
    }
  }, [filters, notify]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    api
      .call<Info>("info")
      .then((value) => {
        setInfo(value);
        if (value.warning) notify(value.warning);
      })
      .catch((e) => notify(e.message));
  }, [notify]);
  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((f) => ({ ...f, query: search })),
      200,
    );
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (
      !result.items.some((i) => i.index_status === "pending") &&
      selected?.index_status !== "pending"
    )
      return;
    const timer = setInterval(() => {
      void refresh();
      if (current.current?.index_status === "pending")
        api
          .call<Item>("get", { id: current.current.id })
          .then((item) =>
            setSelected((s) =>
              s?.id === item.id
                ? {
                    ...s,
                    index_status: item.index_status,
                    index_error: item.index_error,
                  }
                : s,
            ),
          )
          .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [result.items, selected?.index_status, refresh]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (savePromise.current) {
      const ok = await savePromise.current;
      if (!ok) return false;
    }
    if (!draft.current) return true;
    const work = async () => {
      while (draft.current) {
        const snapshot = { ...draft.current };
        setStatus("saving");
        try {
          const saved = await api.call<Item>("save", snapshot);
          await api.call("draft-clear", snapshot).catch(() => {});
          if (draft.current?.revision === snapshot.revision) {
            draft.current = null;
            try {
              localStorage.removeItem(draftKey(snapshot.id));
            } catch {
              /* Saved database is authoritative. */
            }
            setStatus("saved");
            setSelected((s) =>
              s?.id === saved.id
                ? {
                    ...s,
                    document_json: saved.document_json,
                    updated_at: saved.updated_at,
                  }
                : s,
            );
          }
          void refreshRef.current();
        } catch (e: any) {
          setStatus("error");
          notify("保存失败，编辑内容保留在当前窗口，请重试保存。" + e.message);
          return false;
        }
      }
      return true;
    };
    const promise = work();
    savePromise.current = promise;
    try {
      return await promise;
    } finally {
      if (savePromise.current === promise) savePromise.current = null;
    }
  }, [notify]);
  const update = useCallback(
    (patch: Partial<Draft>) => {
      const item = current.current;
      if (!item || item.deleted_at) return;
      let json: unknown = null;
      try {
        json = item.document_json ? JSON.parse(item.document_json) : null;
      } catch {
        /* Imported HTML can lack structured JSON. */
      }
      const next: Draft = {
        id: item.id,
        title: item.title,
        html: item.html,
        document_json: json,
        ...draft.current,
        ...patch,
        revision: ++revision.current,
        time: Date.now(),
      };
      draft.current = next;
      setSelected((s) =>
        s?.id === next.id ? { ...s, title: next.title, html: next.html } : s,
      );
      setStatus("dirty");
      try {
        localStorage.setItem(draftKey(item.id), JSON.stringify(next));
      } catch {
        notify("草稿缓存空间不足，请及时保存；当前编辑内容仍保留在界面中。");
      }
      void api
        .call("draft-put", next)
        .catch((e) => notify("草稿落盘失败，请及时保存：" + e.message));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => void flush(),
        infoRef.current?.preferences.autosaveDelay || 1000,
      );
    },
    [flush, notify],
  );
  useEffect(
    () =>
      api.onClose(() => {
        void flush().then((ok) => {
          if (ok) return api.call("close-ready");
          notify("关闭已取消：请重试保存，成功后再关闭。");
        });
      }),
    [flush, notify],
  );
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (draft.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const exclusive = async <T,>(
    work: () => Promise<T>,
  ): Promise<T | undefined> => {
    if (transitionLock.current) return;
    transitionLock.current = true;
    setTransitioning(true);
    try {
      return await work();
    } finally {
      transitionLock.current = false;
      setTransitioning(false);
    }
  };
  const openItem = async (summary: Item) =>
    exclusive(async () => {
      if (!(await flush())) return;
      try {
        const item = await api.call<Item>("get", { id: summary.id });
        item.hit_page = summary.hit_page;
        setSelected(item);
        setEpoch((n) => n + 1);
        setStatus("saved");
        setTagPicker(false);
        if (!item.deleted_at) await api.call("open", { id: item.id });
        const diskDraft = await api.call<Draft | null>("draft-get", {
          id: item.id,
        });
        const raw = diskDraft
          ? JSON.stringify(diskDraft)
          : localStorage.getItem(draftKey(item.id));
        if (raw && !item.deleted_at) {
          try {
            const recovered = JSON.parse(raw) as Draft;
            if (
              recovered.id === item.id &&
              recovered.time > new Date(item.updated_at).getTime()
            )
              setModal({
                title: "发现未保存的编辑草稿",
                content: (
                  <>
                    <p>
                      “{item.title}”有一份{" "}
                      {date(new Date(recovered.time).toISOString())}{" "}
                      的本地草稿。可以恢复后继续编辑。
                    </p>
                    <div className="modal-actions">
                      <button
                        onClick={() => {
                          localStorage.removeItem(draftKey(item.id));
                          void api.call("draft-clear", recovered);
                          setModal(null);
                        }}
                      >
                        使用已保存内容
                      </button>
                      <button
                        className="primary"
                        onClick={() => {
                          draft.current = {
                            ...recovered,
                            revision: ++revision.current,
                          };
                          setSelected((s) =>
                            s?.id === item.id
                              ? {
                                  ...s,
                                  title: recovered.title,
                                  html: recovered.html,
                                }
                              : s,
                          );
                          setEpoch((n) => n + 1);
                          setStatus("dirty");
                          setModal(null);
                          void flush();
                        }}
                      >
                        恢复草稿
                      </button>
                    </div>
                  </>
                ),
              });
          } catch {
            notify("有一份无法解析的草稿；已保留缓存供检查。");
          }
        }
      } catch (e: any) {
        notify(e.message);
      }
    });
  const create = async () =>
    exclusive(async () => {
      if (!(await flush())) return;
      try {
        const item = await api.call<Item>("create", {
          folderId: filters.folderId,
        });
        setFilters((f) => ({
          ...f,
          view: "all",
          tags: [],
          kind: "",
          favorite: false,
          query: "",
        }));
        setSearch("");
        setSelected(item);
        setEpoch((n) => n + 1);
        setStatus("saved");
        void refresh();
      } catch (e: any) {
        notify(e.message);
      }
    });
  const run = async (action: string, payload?: unknown) =>
    exclusive(async () => {
      if (!(await flush())) return;
      try {
        const value = await api.call(action, payload);
        if (action === "restore" && value) {
          setSelected(null);
          setSearch("");
          setFilters((f) => ({
            ...f,
            folderId: null,
            view: "all",
            tags: [],
            query: "",
            kind: "",
            favorite: false,
          }));
          return value;
        }
        await refresh();
        if (current.current) {
          try {
            const item = await api.call<Item>("get", {
              id: current.current.id,
            });
            setSelected((s) => (s?.id === item.id ? { ...s, ...item } : s));
          } catch {
            setSelected(null);
          }
        }
        return value;
      } catch (e: any) {
        notify(e.message);
      }
    });
  const importFiles = async (paths?: string[]) =>
    exclusive(async () => {
      if (!(await flush())) return;
      setBusy(true);
      try {
        const reports = await api.call<any[]>(
          paths ? "import-dropped" : "import",
          { ...(paths ? { paths } : {}), folderId: filters.folderId },
        );
        await refresh();
        if (reports.length) {
          const failures = reports.filter((r) => !r.ok || r.warnings?.length);
          if (failures.length)
            setModal({
              title: "导入结果",
              content: (
                <>
                  <p>
                    成功 {reports.filter((r) => r.ok).length} 项，共{" "}
                    {reports.length} 项。
                  </p>
                  <div className="import-report">
                    {failures.map((r, i) => (
                      <div key={i}>
                        <strong>{r.name}</strong>
                        <p className={r.ok ? "muted" : "danger-text"}>
                          {r.error || r.warnings.join("；")}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="modal-actions">
                    <button className="primary" onClick={() => setModal(null)}>
                      完成
                    </button>
                  </div>
                </>
              ),
            });
          else notify("已导入 " + reports.length + " 项资料");
        }
      } catch (e: any) {
        notify(e.message);
      } finally {
        setBusy(false);
      }
    });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modal || settingsOpen || !(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFocusMode(false);
        searchRef.current?.focus();
      }
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        void create();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const resize = (which: "sidebar" | "list", event: React.PointerEvent) => {
    event.preventDefault();
    const start = event.clientX,
      width = which === "sidebar" ? sidebarWidth : listWidth;
    const move = (e: PointerEvent) => {
      const maximum = Math.min(
        which === "sidebar" ? 320 : 480,
        window.innerWidth -
          (which === "sidebar" ? listWidth : sidebarWidth) -
          382,
      );
      const value = Math.min(
        maximum,
        Math.max(which === "sidebar" ? 190 : 270, width + e.clientX - start),
      );
      if (which === "sidebar") setSidebarWidth(value);
      else setListWidth(value);
      localStorage.setItem(which + "Width", String(value));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  const askText = (
    title: string,
    initial: string,
    apply: (value: string) => Promise<void> | void,
    description?: string,
  ) => {
    setModal({
      title,
      content: (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("value") as string;
            try {
              await apply(value);
              setModal(null);
            } catch (e: any) {
              notify(e.message);
            }
          }}
        >
          {description && <p>{description}</p>}
          <input
            className="modal-input"
            name="value"
            autoFocus
            defaultValue={initial}
            maxLength={
              title === "编辑链接" ? 10000 : title.includes("文件夹") ? 80 : 50
            }
          />
          <div className="modal-actions">
            <button type="button" onClick={() => setModal(null)}>
              取消
            </button>
            <button className="primary" type="submit">
              确定
            </button>
          </div>
        </form>
      ),
    });
  };
  const manageTags = () =>
    setModal({
      title: "标签管理",
      content: <TagManager tags={result.tags} run={run} notify={notify} />,
    });
  const settings = async () => {
    if (await flush()) setSettingsOpen(true);
  };
  const selectFolder = (id: string | null) => {
    setSearch("");
    setFilters((f) => ({
      ...f,
      folderId: id,
      view: "all",
      tags: [],
      query: "",
      kind: "",
      favorite: false,
    }));
    setMenu(null);
  };
  const newFolder = (parentId: string | null = filters.folderId || null) => {
    setMenu(null);
    askText("新建文件夹", "", async (name) => {
      if (!(await flush())) throw new Error("请先保存当前编辑");
      await api.call("folder-create", { name, parentId });
      await refresh();
    });
  };
  const folderContext = (
    event: React.MouseEvent,
    folder?: Folder,
    item?: Item,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 225),
      y: Math.min(event.clientY, window.innerHeight - 260),
      folder,
      item,
    });
  };
  const move = (item: Item) => {
    setMenu(null);
    setModal({
      title: "移动资料",
      content: (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const folderId = new FormData(event.currentTarget).get("folderId");
            if (
              await run("item-move", {
                id: item.id,
                folderId: folderId || null,
              })
            ) {
              setModal(null);
              notify("资料已移动");
            }
          }}
        >
          <p>将“{item.title}”移动到：</p>
          <select
            aria-label="目标文件夹"
            name="folderId"
            className="modal-input"
            defaultValue={item.folder_id || ""}
          >
            <option value="">未分类（根目录）</option>
            {result.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folderPath(result.folders, folder.id)}
              </option>
            ))}
          </select>
          <div className="modal-actions">
            <button type="button" onClick={() => setModal(null)}>
              取消
            </button>
            <button className="primary">移动</button>
          </div>
        </form>
      ),
    });
  };
  const removeFolder = async (folder: Folder) => {
    setMenu(null);
    if (!(await flush())) return;
    try {
      const removed = await api.call("folder-delete", { id: folder.id });
      if (removed.deleted) {
        selectFolder(removed.parentId);
        if (current.current)
          setSelected(await api.call<Item>("get", { id: current.current.id }));
        notify("文件夹已删除，资料已保留并移至上级");
        return;
      }
      await refresh();
    } catch (e: any) {
      notify(e.message);
    }
  };
  const activeFolder = result.folders.find(
    (folder) => folder.id === filters.folderId,
  );
  const showFolderCards =
    filters.view === "all" &&
    !filters.query &&
    !filters.tags.length &&
    !filters.kind &&
    !filters.favorite;
  const childFolders = showFolderCards
    ? result.folders.filter(
        (folder) => folder.parent_id === (filters.folderId || null),
      )
    : [];
  const selectedTagIds = selected?.tags.map((t) => t.id) || [];
  const changeTag = async (tag: Tag) => {
    if (!selected) return;
    await run("set-tags", {
      id: selected.id,
      tags: selectedTagIds.includes(tag.id)
        ? selectedTagIds.filter((id) => id !== tag.id)
        : [...selectedTagIds, tag.id],
    });
  };
  const title = filters.query
    ? "搜索结果"
    : filters.tags.length
      ? "标签筛选"
      : activeFolder?.name ||
        navs.find((n) => n.id === filters.view)?.label ||
        "全部资料";

  return (
    <div
      className={"app-shell" + (focusMode ? " focus-mode" : "")}
      aria-busy={transitioning}
      onBeforeInputCapture={(e) => {
        if (transitioning) e.preventDefault();
      }}
      onKeyDownCapture={(e) => {
        if (transitioning) e.preventDefault();
      }}
      style={
        {
          "--sidebar-width": sidebarWidth + "px",
          "--list-width": listWidth + "px",
        } as React.CSSProperties
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const paths = api.droppedPaths([...e.dataTransfer.files]);
        if (paths.length) void importFiles(paths);
      }}
      onClick={(e) => {
        const anchor = (e.target as HTMLElement).closest("a");
        if (anchor) {
          e.preventDefault();
          void api
            .call("external", { url: anchor.href })
            .catch((e) => notify(e.message));
        }
      }}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <BookOpen size={23} strokeWidth={1.8} />
          </span>
          <div>
            <strong>拾知</strong>
            <span>让知识，慢慢生长</span>
          </div>
          <span className="version">LOCAL</span>
        </div>
        <button className="new-note primary" onClick={() => void create()}>
          <Plus size={18} />
          <span>新建笔记</span>
          <kbd>Ctrl N</kbd>
        </button>
        <div className="nav-group-label">我的知识库</div>
        <nav>
          {navs.map((n) => (
            <button
              key={n.id}
              className={
                "nav-item " +
                (filters.view === n.id &&
                !filters.tags.length &&
                !filters.folderId
                  ? "active"
                  : "")
              }
              onClick={() => {
                setFilters((f) => ({
                  ...f,
                  view: n.id,
                  tags: [],
                  folderId: null,
                }));
                setTagPicker(false);
              }}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.id === "all" && (
                <small>
                  {Number(result.stats.notes) +
                    Number(result.stats.pdfs) +
                    Number(result.stats.images)}
                </small>
              )}
              {n.id === "trash" && !!result.stats.trash && (
                <small>{result.stats.trash}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="tags-heading folders-heading">
          <span>文件夹</span>
          <button title="新建顶层文件夹" onClick={() => newFolder(null)}>
            <FolderPlus size={16} />
          </button>
        </div>
        <FolderTree
          folders={result.folders}
          selected={filters.folderId || null}
          onSelect={selectFolder}
          onContext={folderContext}
        />
        <div className="tags-heading">
          <span>标签</span>
          <div>
            <button title="管理标签" onClick={manageTags}>
              <MoreHorizontal size={17} />
            </button>
            <button
              title="创建标签"
              onClick={() =>
                askText("创建标签", "", async (name) => {
                  await api.call("tag-add", { name });
                  await refresh();
                })
              }
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
        <div className="sidebar-tags">
          {result.tags.map((tag) => (
            <button
              className={
                "nav-item tag-nav " +
                (filters.tags.includes(tag.id) ? "active" : "")
              }
              key={tag.id}
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  view: "all",
                  folderId: null,
                  tags: f.tags.includes(tag.id)
                    ? f.tags.filter((id) => id !== tag.id)
                    : [...f.tags, tag.id],
                }))
              }
            >
              <Hash size={16} />
              <span>{tag.name}</span>
              <small>{tag.count || 0}</small>
            </button>
          ))}
          {!result.tags.length && (
            <p className="tag-hint">
              给资料加上标签，
              <br />
              让每一次查找更轻松。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span />
            <span>本地知识库</span>
            <small>离线可用</small>
          </div>
          <button className="nav-item" onClick={settings}>
            <Settings size={17} />
            <span>设置与备份</span>
          </button>
          <button
            className="nav-item"
            onClick={() =>
              setModal({
                title: "开始使用拾知",
                content: (
                  <>
                    <p>
                      新建笔记，或将 PDF、Markdown
                      和图片拖入窗口。标签可以自由组合，多选标签时会筛选同时包含这些标签的资料。
                    </p>
                    <div className="shortcut-list">
                      <span>
                        新建笔记 <kbd>Ctrl N</kbd>
                      </span>
                      <span>
                        搜索全部资料 <kbd>Ctrl K</kbd>
                      </span>
                      <span>
                        立即保存 <kbd>Ctrl S</kbd>
                      </span>
                    </div>
                    <p className="muted">
                      文字型 PDF 会自动建立搜索索引；扫描 PDF
                      暂不支持文字搜索。笔记、PDF 备注和图片备注均自动保存。
                    </p>
                    <p className="small muted">
                      拾知 {info?.version} · 为专注与积累而设计
                    </p>
                  </>
                ),
              })
            }
          >
            <HelpCircle size={17} />
            <span>使用帮助</span>
            <ArrowUpRight size={14} />
          </button>
        </div>
      </aside>
      <div
        className="resize-handle sidebar-resize"
        role="separator"
        aria-label="调整导航宽度"
        onPointerDown={(e) => resize("sidebar", e)}
      />
      <section
        className="list-panel"
        onContextMenu={(event) => {
          if (
            (event.target as HTMLElement).closest("input,select") ||
            filters.view === "trash"
          )
            return;
          folderContext(event);
        }}
      >
        <div className="list-header">
          <div className="list-eyebrow">PERSONAL LIBRARY</div>
          <div className="list-title">
            <h1>{title}</h1>
            <span>{result.total}</span>
            {filters.view !== "trash" && (
              <button title="新建文件夹" onClick={() => newFolder()}>
                <FolderPlus size={18} />
              </button>
            )}
            <button
              title="导入资料"
              disabled={busy}
              onClick={() => void importFiles()}
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Upload size={18} />
              )}
            </button>
          </div>
          <div className="search-box">
            <Search size={17} />
            <input
              ref={searchRef}
              aria-label="搜索知识库"
              placeholder="搜索你的知识…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button title="清除搜索" onClick={() => setSearch("")}>
                <X size={14} />
              </button>
            ) : (
              <kbd>Ctrl K</kbd>
            )}
          </div>
          <div className="filters">
            <select
              aria-label="资料类型"
              value={filters.kind}
              onChange={(e) =>
                setFilters((f) => ({ ...f, kind: e.target.value }))
              }
            >
              <option value="">全部类型</option>
              <option value="note">笔记</option>
              <option value="pdf">PDF</option>
              <option value="image">图片</option>
            </select>
            <button
              className={filters.favorite ? "filter-fav active" : "filter-fav"}
              title="只看收藏"
              aria-pressed={filters.favorite}
              onClick={() =>
                setFilters((f) => ({ ...f, favorite: !f.favorite }))
              }
            >
              <Star size={14} />
            </button>
            <select
              aria-label="排序方式"
              value={filters.sort}
              onChange={(e) =>
                setFilters((f) => ({ ...f, sort: e.target.value }))
              }
            >
              <option value="updated">最近修改</option>
              <option value="created">最近创建</option>
              <option value="title">按标题</option>
            </select>
          </div>
          {!!filters.tags.length && (
            <div className="active-filters">
              {filters.tags.map((id) => (
                <button
                  key={id}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      tags: f.tags.filter((t) => t !== id),
                    }))
                  }
                >
                  #{result.tags.find((t) => t.id === id)?.name}
                  <X size={12} />
                </button>
              ))}
              <span>同时包含</span>
            </div>
          )}
          {filters.view === "trash" && result.total > 0 && (
            <button
              className="clear-trash"
              onClick={() => void run("purge", { all: true })}
            >
              清空回收站
            </button>
          )}
        </div>
        <div className="item-list">
          {activeFolder && (
            <div className="folder-breadcrumb">
              <button
                title="返回上级文件夹"
                onClick={() => selectFolder(activeFolder.parent_id)}
              >
                <ChevronLeft size={15} />
              </button>
              <button onClick={() => selectFolder(null)}>全部资料</button>
              <span title={folderPath(result.folders, activeFolder.id)}>
                {" "}
                / {folderPath(result.folders, activeFolder.id)}
              </span>
            </div>
          )}
          {childFolders.map((folder) => (
            <button
              className="folder-card"
              key={folder.id}
              onClick={() => selectFolder(folder.id)}
              onContextMenu={(event) => folderContext(event, folder)}
            >
              <span className="folder-card-icon">
                <FolderIcon size={23} />
              </span>
              <span>
                <strong>{folder.name}</strong>
                <small>
                  {folder.count} 项资料 ·{" "}
                  {
                    result.folders.filter(
                      (child) => child.parent_id === folder.id,
                    ).length
                  }{" "}
                  个子文件夹
                </small>
              </span>
              <ChevronDown size={14} />
            </button>
          ))}
          {loading && !result.items.length ? (
            <div className="list-empty">
              <LoaderCircle className="spin" size={24} />
              <p>正在读取资料…</p>
            </div>
          ) : !result.items.length && !childFolders.length ? (
            <div className="list-empty">
              <Search size={28} />
              <h3>
                {filters.query || filters.tags.length || filters.kind
                  ? "没有找到相关资料"
                  : "这里还没有资料"}
              </h3>
              <p>
                {filters.query || filters.tags.length || filters.kind
                  ? "试试其他关键词或减少筛选条件"
                  : "新建笔记，或导入你的第一份资料"}
              </p>
              {filters.view === "all" && !filters.query && (
                <button onClick={() => void importFiles()}>
                  <Upload size={15} />
                  导入资料
                </button>
              )}
            </div>
          ) : (
            result.items.map((item) => (
              <button
                key={item.id}
                className={
                  "item-card " + (selected?.id === item.id ? "selected" : "")
                }
                onClick={() => void openItem(item)}
                onContextMenu={(event) => {
                  if (!item.deleted_at) folderContext(event, undefined, item);
                }}
              >
                <div className="item-card-top">
                  <span className={"type-icon " + item.kind}>
                    <TypeIcon kind={item.kind} />
                  </span>
                  <span className="item-kind">{kinds[item.kind]}</span>
                  {item.index_status === "pending" && (
                    <span className="indexing-dot" title="正在提取 PDF 文字" />
                  )}
                  <span className="item-date">{date(item.updated_at)}</span>
                  {!!item.favorite && (
                    <Star className="star-filled" size={13} />
                  )}
                </div>
                <h3>
                  <Highlight text={item.title} query={filters.query} />
                </h3>
                <p>
                  <Highlight
                    text={
                      item.preview ||
                      (item.kind === "pdf"
                        ? "点击阅读 PDF，添加你的思考与备注"
                        : item.kind === "image"
                          ? "点击查看图片与备注"
                          : "还没有内容，记下你的第一个想法")
                    }
                    query={filters.query}
                  />
                </p>
                <div className="card-tags">
                  {item.tags.slice(0, 3).map((tag) => (
                    <span key={tag.id}>#{tag.name}</span>
                  ))}
                  {item.tags.length > 3 && <span>+{item.tags.length - 3}</span>}
                  {item.hit_page && <small>命中第 {item.hit_page} 页</small>}
                </div>
              </button>
            ))
          )}
          {result.items.length < result.total && (
            <button
              className="load-more"
              onClick={async () => {
                try {
                  const extra = await api.call<ListResult>("list", {
                    ...filters,
                    offset: result.items.length,
                  });
                  setResult((r) => ({
                    ...r,
                    items: [...r.items, ...extra.items],
                  }));
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              加载更多（{result.items.length} / {result.total}）
            </button>
          )}
        </div>
        <div className="list-footer">
          <span>{result.total} 项资料</span>
          <span>一点一滴，皆有所得</span>
        </div>
      </section>
      <div
        className="resize-handle list-resize"
        role="separator"
        aria-label="调整列表宽度"
        onPointerDown={(e) => resize("list", e)}
      />
      <main className="content-panel">
        {selected ? (
          <>
            <header className="content-header">
              <div className="breadcrumb">
                <button
                  title={focusMode ? "退出专注阅读" : "展开阅读"}
                  onClick={() => setFocusMode((v) => !v)}
                >
                  {focusMode ? (
                    <PanelLeftOpen size={18} />
                  ) : (
                    <PanelLeftClose size={18} />
                  )}
                </button>
                <span>我的知识库</span>
                <ChevronDown size={12} className="breadcrumb-arrow" />
                <TypeIcon kind={selected.kind} size={14} />
                <span>{kinds[selected.kind]}</span>
              </div>
              <div className="content-actions">
                {!selected.deleted_at && (
                  <button title="移动到文件夹" onClick={() => move(selected)}>
                    <MoveRight size={18} />
                  </button>
                )}
                <button
                  className={"save-status " + status}
                  onClick={() => void flush()}
                  title="点击立即保存或重试"
                >
                  {status === "saving" ? (
                    <LoaderCircle size={13} className="spin" />
                  ) : status === "error" ? (
                    <AlertCircle size={13} />
                  ) : status === "dirty" ? (
                    <span className="dirty-dot" />
                  ) : (
                    <Check size={14} />
                  )}
                  {
                    {
                      saved: "已保存",
                      dirty: "待保存",
                      saving: "保存中",
                      error: "保存失败 · 重试",
                    }[status]
                  }
                </button>
                {!selected.deleted_at && (
                  <button
                    title={selected.favorite ? "取消收藏" : "收藏"}
                    onClick={() => void run("favorite", { id: selected.id })}
                  >
                    <Star
                      size={18}
                      className={selected.favorite ? "star-filled" : ""}
                    />
                  </button>
                )}
                {selected.kind === "note" && (
                  <button
                    title="导出 Markdown 与图片"
                    onClick={async () => {
                      const value = await run("export", { id: selected.id });
                      if (value) notify("笔记已导出：" + value);
                    }}
                  >
                    <Download size={18} />
                  </button>
                )}
                {selected.deleted_at ? (
                  <>
                    <button
                      title="恢复资料"
                      onClick={() =>
                        void run("trash", { id: selected.id, restore: true })
                      }
                    >
                      <RotateCcw size={18} />
                    </button>
                    <button
                      title="永久删除"
                      onClick={() => void run("purge", { id: selected.id })}
                    >
                      <Trash2 size={18} />
                    </button>
                  </>
                ) : (
                  <button
                    title="移入回收站"
                    onClick={async () => {
                      await run("trash", { id: selected.id });
                      setTagPicker(false);
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </header>
            {selected.deleted_at && (
              <div className="trash-banner">
                <Trash2 size={15} />
                此资料在回收站中，恢复后可继续编辑。
                <button
                  onClick={() =>
                    void run("trash", { id: selected.id, restore: true })
                  }
                >
                  恢复资料
                </button>
              </div>
            )}
            <div className="document-scroll">
              <div className="document-heading">
                <div className="doc-eyebrow">
                  <span className={"type-icon " + selected.kind}>
                    <TypeIcon kind={selected.kind} size={15} />
                  </span>
                  {kinds[selected.kind]}
                  <span className="eyebrow-line" />
                </div>
                <input
                  aria-label="资料标题"
                  className="document-title"
                  placeholder="未命名笔记"
                  value={selected.title}
                  disabled={!!selected.deleted_at}
                  maxLength={500}
                  onChange={(e) => update({ title: e.target.value })}
                />
                <div className="document-meta">
                  <span>创建于 {date(selected.created_at)}</span>
                  <span>·</span>
                  <span>修改于 {date(selected.updated_at)}</span>
                </div>
                <div className="document-tags">
                  {selected.tags.map((tag) => (
                    <span key={tag.id}># {tag.name}</span>
                  ))}
                  {!selected.deleted_at && (
                    <div className="tag-picker-wrap">
                      <button
                        className="add-tag"
                        onClick={() => setTagPicker((v) => !v)}
                      >
                        <Plus size={13} />
                        添加标签
                      </button>
                      {tagPicker && (
                        <div className="tag-picker">
                          <div className="tag-picker-title">
                            为资料添加标签
                            <button
                              title="关闭标签选择"
                              onClick={() => setTagPicker(false)}
                            >
                              <X size={14} />
                            </button>
                          </div>
                          {result.tags.map((tag) => (
                            <button
                              className="tag-choice"
                              key={tag.id}
                              onClick={() => void changeTag(tag)}
                            >
                              <span
                                className={
                                  "checkbox " +
                                  (selectedTagIds.includes(tag.id)
                                    ? "checked"
                                    : "")
                                }
                              >
                                {selectedTagIds.includes(tag.id) && (
                                  <Check size={12} />
                                )}
                              </span>
                              <Hash size={13} />
                              {tag.name}
                            </button>
                          ))}
                          <button
                            className="tag-create"
                            onClick={() =>
                              askText("创建标签并添加", "", async (name) => {
                                const tag = await api.call<Tag>("tag-add", {
                                  name,
                                });
                                await run("set-tags", {
                                  id: selected.id,
                                  tags: [...selectedTagIds, tag.id],
                                });
                              })
                            }
                          >
                            <Plus size={14} />
                            创建新标签
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {selected.kind === "pdf" && (
                <>
                  <div className={"pdf-index-status " + selected.index_status}>
                    {selected.index_status === "pending" ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : selected.index_status === "ready" ? (
                      <Check size={14} />
                    ) : (
                      <AlertCircle size={14} />
                    )}{" "}
                    {selected.index_status === "pending"
                      ? "正在后台提取文字，完成后可搜索正文"
                      : selected.index_status === "ready"
                        ? "文字已索引 · 可搜索正文"
                        : selected.index_error || "无法提取文字，仍可阅读"}
                  </div>
                  <PdfReader
                    key={selected.asset}
                    asset={selected.asset!}
                    hitPage={selected.hit_page}
                  />
                </>
              )}
              {selected.kind === "image" && (
                <div className="image-preview">
                  <img
                    src={"kbasset://asset/" + selected.asset}
                    alt={selected.title}
                  />
                </div>
              )}
              {selected.kind !== "note" && (
                <div className="notes-section-label">
                  <FileText size={15} />
                  我的备注
                </div>
              )}
              <Editor
                key={
                  selected.id + ":" + epoch + ":" + Boolean(selected.deleted_at)
                }
                html={selected.html}
                readOnly={!!selected.deleted_at}
                onChange={(html, json) => update({ html, document_json: json })}
                onError={notify}
                onLink={(apply, value) =>
                  askText(
                    "编辑链接",
                    value,
                    apply,
                    "输入完整网址，留空可移除链接。",
                  )
                }
              />
            </div>
            <footer className="document-footer">
              <span>
                {selected.kind === "note" ? "笔记" : "备注"} ·{" "}
                {selected.html.replace(/<[^>]*>/g, "").length} 字符
              </span>
              <span>
                <span className="tiny-dot" />
                自动保存已开启
              </span>
            </footer>
          </>
        ) : (
          <>
            <header className="content-header">
              <span className="breadcrumb">我的知识库 / 欢迎</span>
              <span className="welcome-date">
                {new Date().toLocaleDateString("zh-CN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </span>
            </header>
            <div className="welcome">
              <div className="welcome-orbit">
                <div className="orbit-icon orbit-file">
                  <FileText size={23} />
                </div>
                <div className="orbit-icon orbit-tag">
                  <Hash size={20} />
                </div>
                <div className="welcome-book">
                  <BookOpen size={51} strokeWidth={1.4} />
                </div>
                <div className="orbit-icon orbit-star">
                  <Star size={18} />
                </div>
              </div>
              <div className="welcome-eyebrow">A SPACE FOR YOUR IDEAS</div>
              <h2>
                把零散的灵感，
                <br />
                变成自己的知识。
              </h2>
              <p>
                记录思考，收藏资料，让每一次积累都有迹可循。
                <br />
                从一篇笔记开始，建立属于你的知识库。
              </p>
              <div className="welcome-actions">
                <button className="primary" onClick={() => void create()}>
                  <Plus size={17} />
                  写下第一篇笔记
                </button>
                <button disabled={busy} onClick={() => void importFiles()}>
                  <Upload size={17} />
                  导入已有资料
                </button>
              </div>
              <div className="welcome-features">
                <span>
                  <Check size={14} />
                  离线使用
                </span>
                <span>
                  <Check size={14} />
                  自动保存
                </span>
                <span>
                  <Check size={14} />
                  数据属于你
                </span>
              </div>
              <div className="drop-hint">支持拖入 PDF、Markdown 和图片</div>
            </div>
          </>
        )}
      </main>
      {drag && (
        <div className="drop-overlay">
          <Upload size={44} />
          <h2>放下文件，收入知识库</h2>
          <p>PDF · Markdown · PNG / JPG / GIF / WebP</p>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <AlertCircle size={17} />
          <span>{toast}</span>
          <button title="关闭通知" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {settingsOpen && info && (
        <SettingsPanel
          info={info}
          onInfo={setInfo}
          onAction={run}
          notify={notify}
          onClose={() => setSettingsOpen(false)}
          onRestored={() => {
            setSelected(null);
            setEpoch((n) => n + 1);
            setSettingsOpen(false);
            selectFolder(null);
          }}
        />
      )}
      {menu && (
        <div
          className="context-menu"
          role="menu"
          aria-label="资料管理菜单"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="context-menu-caption">
            {menu.folder?.name ||
              menu.item?.title ||
              activeFolder?.name ||
              "资料管理"}
          </span>
          {menu.folder ? (
            <>
              <button
                role="menuitem"
                onClick={() => selectFolder(menu.folder!.id)}
              >
                <FolderOpen size={16} />
                打开文件夹
              </button>
              <button
                role="menuitem"
                onClick={() => newFolder(menu.folder!.id)}
              >
                <FolderPlus size={16} />
                新建子文件夹
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  const folder = menu.folder!;
                  setMenu(null);
                  askText("重命名文件夹", folder.name, async (name) => {
                    await api.call("folder-rename", { id: folder.id, name });
                    await refresh();
                  });
                }}
              >
                <FileText size={16} />
                重命名文件夹
              </button>
              <div className="context-divider" />
              <button
                role="menuitem"
                className="danger-text"
                onClick={() => void removeFolder(menu.folder!)}
              >
                <Trash2 size={16} />
                删除文件夹并保留资料
              </button>
            </>
          ) : (
            <>
              {menu.item && (
                <>
                  <button role="menuitem" onClick={() => move(menu.item!)}>
                    <MoveRight size={16} />
                    移动到文件夹
                  </button>
                  <div className="context-divider" />
                </>
              )}
              <button role="menuitem" onClick={() => newFolder()}>
                <FolderPlus size={16} />
                新建文件夹
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void create();
                }}
              >
                <Plus size={16} />
                新建笔记
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void importFiles();
                }}
              >
                <Upload size={16} />
                导入资料
              </button>
            </>
          )}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal.title}
          >
            <header>
              <h2>{modal.title}</h2>
              <button title="关闭对话框" onClick={() => setModal(null)}>
                <X size={20} />
              </button>
            </header>
            <div className="modal-body">{modal.content}</div>
          </section>
        </div>
      )}
    </div>
  );
}

function TagManager({
  tags: initial,
  run,
  notify,
}: {
  tags: Tag[];
  run: (action: string, payload?: unknown) => Promise<any>;
  notify: (message: string) => void;
}) {
  const [tags, setTags] = useState(initial),
    [name, setName] = useState(""),
    [editing, setEditing] = useState(""),
    [rename, setRename] = useState(""),
    [source, setSource] = useState(""),
    [target, setTarget] = useState("");
  const reload = async () => {
    const data = await api.call<ListResult>("list");
    setTags(data.tags);
  };
  const action = async (kind: string, payload: unknown) => {
    const ok = await run(kind, payload);
    if (ok !== undefined && ok !== false) {
      await reload();
      setEditing("");
    }
  };
  return (
    <div className="tag-manager">
      <form
        className="tag-new"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await action("tag-add", { name });
          setName("");
        }}
      >
        <input
          aria-label="新标签名称"
          placeholder="输入新标签名称"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary">
          <Plus size={15} />
          创建
        </button>
      </form>
      <div className="manage-tag-list">
        {tags.map((tag) => (
          <div className="manage-tag-row" key={tag.id}>
            <Hash size={15} />
            {editing === tag.id ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await action("tag-rename", { id: tag.id, name: rename });
                }}
              >
                <input
                  aria-label="修改标签名称"
                  autoFocus
                  maxLength={50}
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                />
                <button>保存</button>
                <button type="button" onClick={() => setEditing("")}>
                  取消
                </button>
              </form>
            ) : (
              <>
                <span>{tag.name}</span>
                <small>{tag.count} 项</small>
                <button
                  onClick={() => {
                    setEditing(tag.id);
                    setRename(tag.name);
                  }}
                >
                  改名
                </button>
                <button
                  title={"删除标签 " + tag.name}
                  onClick={() => void action("tag-delete", { id: tag.id })}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
        {!tags.length && (
          <p className="muted">还没有标签。创建第一个标签吧。</p>
        )}
      </div>
      <div className="merge-tags">
        <h3>合并标签</h3>
        <p>将来源标签的资料归入目标标签，并删除来源标签。</p>
        <div>
          <select
            aria-label="来源标签"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">选择来源</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <span>→</span>
          <select
            aria-label="目标标签"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">选择目标</option>
            {tags
              .filter((t) => t.id !== source)
              .map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
          </select>
          <button
            disabled={!source || !target}
            onClick={async () => {
              if (source === target) {
                notify("请选择不同标签");
                return;
              }
              await action("tag-merge", { source, target });
              setSource("");
              setTarget("");
            }}
          >
            合并
          </button>
        </div>
      </div>
    </div>
  );
}
