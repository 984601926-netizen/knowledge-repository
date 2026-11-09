import { useState } from "react";
import {
  Settings,
  Palette,
  FolderOpen,
  DatabaseBackup,
  Keyboard,
  Info as InfoIcon,
  X,
  Search,
  Check,
  RotateCcw,
  LoaderCircle,
  BookOpen,
} from "lucide-react";
import type { Info, Preferences } from "./types";

const pages = [
  { id: "general", title: "通用", terms: "知识库 本地 路径", icon: Settings },
  {
    id: "appearance",
    title: "外观与编辑",
    terms: "主题 字号 自动保存",
    icon: Palette,
  },
  {
    id: "files",
    title: "文件管理",
    terms: "导入 文件夹 附件",
    icon: FolderOpen,
  },
  {
    id: "backup",
    title: "备份与恢复",
    terms: "备份 位置 恢复 目录",
    icon: DatabaseBackup,
  },
  {
    id: "shortcuts",
    title: "快捷键",
    terms: "键盘 搜索 新建 保存",
    icon: Keyboard,
  },
  { id: "about", title: "关于", terms: "版本 更新", icon: InfoIcon },
];
type Props = {
  info: Info;
  onInfo: (info: Info) => void;
  onAction: (action: string, payload?: unknown) => Promise<any>;
  onClose: () => void;
  onRestored: () => void;
  notify: (message: string) => void;
};
export default function SettingsPanel({
  info,
  onInfo,
  onAction,
  onClose,
  onRestored,
  notify,
}: Props) {
  const [page, setPage] = useState("general"),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false);
  const preferences = info.preferences;
  const perform = async (action: string, payload?: unknown) => {
    if (busy) return;
    setBusy(true);
    try {
      return await onAction(action, payload);
    } finally {
      setBusy(false);
    }
  };
  const change = async (patch: Partial<Preferences>) => {
    const updated = await perform("settings-update", patch);
    if (updated) {
      onInfo({ ...info, preferences: updated });
      notify("设置已保存");
    }
  };
  const visible = pages.filter((p) =>
    (p.title + p.terms).includes(search.trim()),
  );
  const active = visible.find((p) => p.id === page) || visible[0];
  const location = async () => {
    const result = await perform("backup-location");
    if (result) {
      onInfo({
        ...info,
        backupDir: result.preferences.backupDir,
        preferences: result.preferences,
      });
      notify(
        "备份位置已更改，并已在新位置创建完整备份；原位置的备份保持不变。",
      );
    }
  };
  const row = (
    title: string,
    description: string,
    control: React.ReactNode,
  ) => (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {control}
    </div>
  );
  return (
    <div
      className="settings-backdrop"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      <section
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <aside className="settings-nav">
          <div className="settings-brand">
            <Settings size={19} />
            设置
          </div>
          <label className="settings-search">
            <Search size={15} />
            <input
              aria-label="搜索设置"
              placeholder="搜索设置…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <span className="settings-nav-label">偏好设置</span>
          <nav aria-label="设置分类">
            {visible.map((p) => (
              <button
                key={p.id}
                className={active?.id === p.id ? "active" : ""}
                onClick={() => setPage(p.id)}
              >
                <p.icon size={17} />
                {p.title}
              </button>
            ))}
            {!visible.length && (
              <p className="muted small">没有匹配的设置分类</p>
            )}
          </nav>
          <div className="settings-local">
            <span className="tiny-dot" />
            拾知 {info.version}
            <small>个人 · 本地 · 离线</small>
          </div>
        </aside>
        <div className="settings-detail">
          <header>
            <div>
              <span>PREFERENCES</span>
              <h2>{active?.title || "搜索设置"}</h2>
            </div>
            {busy && <LoaderCircle size={17} className="spin" />}
            <button disabled={busy} title="关闭设置" onClick={onClose}>
              <X size={20} />
            </button>
          </header>
          <div className="settings-page" aria-busy={busy}>
            {active?.id === "general" && (
              <>
                <h3>属于你的本地知识库</h3>
                <p className="settings-intro">
                  笔记、资料与标签保存在本机，离线也可以继续积累。
                </p>
                <div className="settings-card">
                  <strong>知识库目录</strong>
                  <code>{info.root}</code>
                  <button
                    disabled={busy}
                    onClick={() => void perform("reveal")}
                  >
                    <FolderOpen size={15} />
                    打开知识库目录
                  </button>
                </div>
                {row(
                  "资料组织",
                  "文件夹按层级整理资料，标签用于跨文件夹关联；两种方式可以同时使用。",
                  <span className="setting-badge">文件夹 + 标签</span>,
                )}
                {row(
                  "数据保存",
                  "编辑时先写入独立草稿，再按所选间隔自动保存；切换资料与关闭时检查待保存内容。",
                  <Check size={18} />,
                )}
                <button
                  className="settings-link"
                  onClick={() => setPage("backup")}
                >
                  管理备份位置与恢复 →
                </button>
              </>
            )}
            {active?.id === "appearance" && (
              <>
                <h3>按你的习惯阅读与书写</h3>
                <p className="settings-intro">
                  修改立即生效，并在下次打开时继续使用。
                </p>
                {row(
                  "界面主题",
                  "选择浅色、深色，或跟随 Windows 系统主题。",
                  <select
                    aria-label="界面主题"
                    disabled={busy}
                    value={preferences.theme}
                    onChange={(e) =>
                      void change({
                        theme: e.target.value as Preferences["theme"],
                      })
                    }
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                    <option value="system">跟随系统</option>
                  </select>,
                )}
                {row(
                  "笔记正文字号",
                  "调整笔记及资料备注的正文字号。",
                  <select
                    aria-label="笔记正文字号"
                    disabled={busy}
                    value={preferences.editorFontSize}
                    onChange={(e) =>
                      void change({ editorFontSize: Number(e.target.value) })
                    }
                  >
                    {[12, 14, 16, 18, 20, 22].map((size) => (
                      <option key={size} value={size}>
                        {size} px
                      </option>
                    ))}
                  </select>,
                )}
                {row(
                  "自动保存间隔",
                  "停止输入后自动保存；Ctrl S 可随时立即保存。",
                  <select
                    aria-label="自动保存间隔"
                    disabled={busy}
                    value={preferences.autosaveDelay}
                    onChange={(e) =>
                      void change({ autosaveDelay: Number(e.target.value) })
                    }
                  >
                    <option value={500}>0.5 秒</option>
                    <option value={1000}>1 秒</option>
                    <option value={2000}>2 秒</option>
                    <option value={5000}>5 秒</option>
                  </select>,
                )}
                <div
                  className="settings-preview"
                  style={{ fontSize: preferences.editorFontSize }}
                >
                  <strong>阅读预览</strong>
                  <p>
                    把零散的灵感，变成自己的知识。每一次积累，都值得被妥善保存。
                  </p>
                </div>
              </>
            )}
            {active?.id === "files" && (
              <>
                <h3>文件夹与导入资料</h3>
                <p className="settings-intro">
                  在资料列表空白处右键，快速新建文件夹、笔记或导入资料；右键资料可移动到其他文件夹。
                </p>
                {row(
                  "当前文件夹",
                  "在文件夹内新建或导入时，资料自动归入当前文件夹。全部资料仍可查看整个知识库。",
                  <span className="setting-badge">自动归类</span>,
                )}
                {row(
                  "附件保存方式",
                  "导入的文件复制到知识库内部，原文件移动或删除后仍可阅读。",
                  <button
                    disabled={busy}
                    onClick={() => void perform("reveal", { assets: true })}
                  >
                    打开附件目录
                  </button>,
                )}
                <div className="settings-card">
                  <strong>支持的格式</strong>
                  <p>
                    笔记、Markdown、PDF、PNG、JPG、GIF、WebP。单个文件上限 200
                    MB，Markdown 上限 10 MB，每批最多 500 项。
                  </p>
                  <p className="small muted">
                    文本型 PDF 自动索引；扫描 PDF 暂不做
                    OCR。删除文件夹会保留其中的资料，删除资料则进入回收站。
                  </p>
                </div>
              </>
            )}
            {active?.id === "backup" && (
              <>
                <h3>把积累妥善留存</h3>
                <p className="settings-intro">
                  每天首次打开创建自动备份，保留最近 7
                  份。手动备份及恢复前备份单独保留。
                </p>
                <div className="settings-card">
                  <strong>备份保存位置</strong>
                  <code data-testid="backup-location">{info.backupDir}</code>
                  <div className="settings-button-row">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void location()}
                    >
                      <FolderOpen size={15} />
                      更改备份位置
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void perform("reveal", { backups: true })}
                    >
                      打开备份目录
                    </button>
                  </div>
                  <p className="small muted">
                    更改时会在新位置创建一份完整备份，成功后才切换。旧备份保留在原位置；新位置不能位于知识库数据目录内。
                  </p>
                </div>
                {row(
                  "创建完整备份",
                  "包含已保存笔记、原始文件、文件夹、标签及回收站资料，暂限 512 MB。",
                  <button
                    disabled={busy}
                    onClick={async () => {
                      const file = await perform("backup");
                      if (file) notify("完整备份已保存：" + file);
                    }}
                  >
                    <DatabaseBackup size={15} />
                    创建完整备份
                  </button>,
                )}
                {row(
                  "从备份恢复",
                  "校验后替换当前知识库；恢复前先备份当前数据，备份位置和界面偏好保持不变。",
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (await perform("restore")) {
                        onRestored();
                        notify("恢复成功，恢复前的数据已另行备份");
                      }
                    }}
                  >
                    <RotateCcw size={15} />
                    从备份恢复
                  </button>,
                )}
              </>
            )}
            {active?.id === "shortcuts" && (
              <>
                <h3>让常用操作更顺手</h3>
                <p className="settings-intro">以下快捷键可在主界面使用。</p>
                <div className="settings-card shortcut-list">
                  <span>
                    新建笔记<kbd>Ctrl N</kbd>
                  </span>
                  <span>
                    搜索资料<kbd>Ctrl K</kbd>
                  </span>
                  <span>
                    立即保存<kbd>Ctrl S</kbd>
                  </span>
                  <span>
                    撤销编辑<kbd>Ctrl Z</kbd>
                  </span>
                  <span>
                    重做编辑<kbd>Ctrl Shift Z</kbd>
                  </span>
                  <span>
                    关闭设置<kbd>Esc</kbd>
                  </span>
                </div>
                <p>在资料列表或文件夹上点击鼠标右键，可使用更多整理操作。</p>
              </>
            )}
            {active?.id === "about" && (
              <>
                <div className="settings-about-icon">
                  <BookOpen size={36} />
                </div>
                <h3>拾知</h3>
                <p className="settings-intro">
                  个人知识库 · 版本 {info.version}
                </p>
                <div className="settings-card">
                  <strong>本次更新</strong>
                  <ul>
                    <li>自定义备份保存位置，并在切换前验证备份成功。</li>
                    <li>
                      带左侧分类导航的设置界面，支持主题、字号和自动保存间隔。
                    </li>
                    <li>
                      资料区右键新建文件夹，支持子文件夹、改名和资料移动。
                    </li>
                  </ul>
                </div>
                <p className="small muted">
                  本地运行，无需注册。当前通过安装包手动更新，未启用云同步或在线更新服务。
                </p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
