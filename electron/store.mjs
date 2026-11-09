import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const require = createRequire(import.meta.url);
const SQL = await initSqlJs({
  locateFile: (name) =>
    path.join(path.dirname(require.resolve("sql.js")), name),
});
const ASSET = /^[a-f0-9-]{36}\.(pdf|png|jpg|jpeg|gif|webp)$/;
const imageTypes = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const now = () => new Date().toISOString();
const sha = (data) => createHash("sha256").update(data).digest("hex");
const MAX_ARCHIVE = 512 * 1024 * 1024;
export function cleanHtml(html) {
  return sanitizeHtml(String(html || ""), {
    allowedTags: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "strong",
      "b",
      "em",
      "i",
      "s",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "hr",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      ol: ["start"],
    },
    allowedSchemes: ["http", "https", "mailto", "kbasset"],
    allowedSchemesByTag: { img: ["kbasset"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attrs) => ({
        tagName: tag,
        attribs: { ...attrs, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  });
}
export function plainText(html) {
  return sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: (t) => t,
  })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
export function atomicWrite(filename, bytes) {
  const temp = filename + "." + randomUUID() + ".tmp";
  try {
    const fd = fs.openSync(temp, "wx");
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, filename);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function validDatabase(db) {
  const result = db.exec("PRAGMA quick_check");
  if (result[0]?.values[0]?.[0] !== "ok")
    throw new Error("数据库完整性校验失败");
  const tables =
    db
      .exec("SELECT name FROM sqlite_master WHERE type='table'")[0]
      ?.values.flat() ?? [];
  for (const name of ["items", "tags", "item_tags", "pdf_pages", "meta"])
    if (!tables.includes(name)) throw new Error("不是受支持的拾知数据库");
  const version = db.exec("SELECT value FROM meta WHERE key='version'")[0]
    ?.values[0]?.[0];
  if (!["1", "2"].includes(version)) throw new Error("不支持此备份的数据版本");
  if (
    version === "2" &&
    (!tables.includes("folders") ||
      !db
        .exec("PRAGMA table_info(items)")[0]
        ?.values.some((row) => row[1] === "folder_id"))
  )
    throw new Error("文件夹数据结构无效");
  if (db.exec("PRAGMA foreign_key_check").length)
    throw new Error("数据库关联校验失败");
  if (version === "2") {
    const columns =
      db.exec("PRAGMA table_info(folders)")[0]?.values.map((row) => row[1]) ||
      [];
    if (
      !["id", "name", "parent_id", "created_at"].every((name) =>
        columns.includes(name),
      )
    )
      throw new Error("文件夹数据结构无效");
    const parents = new Map(
        db.exec("SELECT id,parent_id FROM folders")[0]?.values || [],
      ),
      complete = new Set();
    for (const id of parents.keys()) {
      let current = id;
      const branch = new Set();
      while (current && !complete.has(current)) {
        if (branch.has(current)) throw new Error("文件夹包含循环层级");
        branch.add(current);
        current = parents.get(current);
      }
      for (const ancestor of branch) complete.add(ancestor);
    }
  }
}
function upgradeFolders(db) {
  if (
    db.exec("SELECT value FROM meta WHERE key='version'")[0]?.values[0]?.[0] ===
    "2"
  )
    return;
  db.run(`CREATE TABLE folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX folder_sibling_name ON folders(COALESCE(parent_id,''),name COLLATE NOCASE);
    ALTER TABLE items ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
    CREATE INDEX item_folder ON items(folder_id,deleted_at);
    UPDATE meta SET value='2' WHERE key='version';`);
}

export class Library {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.backupDir = options.backupDir || this.root + "-backups";
    this.write = options.write || atomicWrite;
    this.warning = "";
    // A journal makes a process exit between the two directory renames recoverable.
    const journal = this.root + ".restore-journal.json";
    if (fs.existsSync(journal)) {
      const pending = JSON.parse(fs.readFileSync(journal, "utf8"));
      if (
        pending.root !== this.root ||
        !String(pending.previous).startsWith(this.root + ".rollback-") ||
        !String(pending.stage).startsWith(this.root + ".restore-")
      )
        throw new Error("恢复日志无效，请检查知识库目录");
      if (!fs.existsSync(this.root)) {
        if (!fs.existsSync(pending.previous))
          throw new Error("恢复中断，找不到原知识库；请保留目录并从备份恢复");
        fs.renameSync(pending.previous, this.root);
      }
      fs.unlinkSync(journal);
      this.warning = "检测到恢复过程曾中断，已重新打开完整的知识库。";
    }
    fs.mkdirSync(path.join(this.root, "assets"), { recursive: true });
    const file = path.join(this.root, "library.sqlite");
    const existing = fs.existsSync(file);
    if (fs.existsSync(file)) {
      try {
        this.db = new SQL.Database(fs.readFileSync(file));
        validDatabase(this.db);
      } catch (error) {
        this.db?.close();
        if (!fs.existsSync(file + ".previous")) throw error;
        this.db = new SQL.Database(fs.readFileSync(file + ".previous"));
        validDatabase(this.db);
        fs.copyFileSync(file, file + ".corrupt-" + Date.now());
        atomicWrite(file, this.db.export());
        this.warning =
          "数据库未通过校验，已恢复上一份已保存数据；原文件已保留供检查。";
      }
    } else {
      this.db = new SQL.Database();
      this.db.run(`
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        INSERT INTO meta VALUES('version','1');
        CREATE TABLE items(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('note','pdf','image')),title TEXT NOT NULL,
          html TEXT NOT NULL DEFAULT '',document_json TEXT,plain TEXT NOT NULL DEFAULT '',asset TEXT,
          favorite INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,opened_at TEXT,
          deleted_at TEXT,index_status TEXT NOT NULL DEFAULT 'none',index_error TEXT NOT NULL DEFAULT '');
        CREATE TABLE tags(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE);
        CREATE TABLE item_tags(item_id TEXT REFERENCES items(id) ON DELETE CASCADE,tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(item_id,tag_id));
        CREATE TABLE pdf_pages(item_id TEXT REFERENCES items(id) ON DELETE CASCADE,page INTEGER,text TEXT NOT NULL,PRIMARY KEY(item_id,page));
        CREATE INDEX item_tags_tag ON item_tags(tag_id,item_id);
        CREATE INDEX items_modified ON items(deleted_at,updated_at);
      `);
      atomicWrite(file, this.db.export());
    }
    this.db.run("PRAGMA foreign_keys=ON");
    if (
      this.rows("SELECT value FROM meta WHERE key='version'")[0].value === "1"
    ) {
      if (existing)
        this.backup(
          path.join(this.backupDir, "before-upgrade-" + Date.now() + ".szkb"),
        );
      this.transaction(() => upgradeFolders(this.db));
    }
  }
  rows(sql, args = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(args);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  transaction(fn) {
    const before = this.db.export();
    try {
      this.db.run("BEGIN");
      const value = fn();
      this.db.run("COMMIT");
      const file = path.join(this.root, "library.sqlite");
      this.write(file + ".previous", before);
      this.write(file, this.db.export());
      return value;
    } catch (error) {
      this.db.close();
      this.db = new SQL.Database(before);
      this.db.run("PRAGMA foreign_keys=ON");
      throw new Error("保存失败，已保留上次保存的数据：" + error.message);
    }
  }
  get(id) {
    const item = this.rows("SELECT * FROM items WHERE id=?", [id])[0];
    if (!item) throw new Error("资料不存在");
    item.tags = this.rows(
      "SELECT t.* FROM tags t JOIN item_tags it ON it.tag_id=t.id WHERE it.item_id=? ORDER BY t.name",
      [id],
    );
    return item;
  }
  create(title = "", html = "", kind = "note", asset = null, folderId = null) {
    if (folderId) this.folder(folderId);
    const id = randomUUID(),
      stamp = now();
    this.transaction(() =>
      this.db.run(
        "INSERT INTO items(id,kind,title,html,plain,asset,created_at,updated_at,index_status,folder_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          kind,
          title.trim() || "未命名笔记",
          cleanHtml(html),
          plainText(cleanHtml(html)),
          asset,
          stamp,
          stamp,
          kind === "pdf" ? "pending" : "none",
          folderId,
        ],
      ),
    );
    return this.get(id);
  }
  save(id, patch) {
    const item = this.get(id);
    if (item.deleted_at) throw new Error("请先从回收站恢复资料");
    const html = cleanHtml(patch.html ?? item.html);
    // HTML is authoritative for rendering/search; JSON is retained for lossless editor structure.
    const json =
      patch.document_json === undefined
        ? item.document_json
        : JSON.stringify(patch.document_json);
    this.transaction(() =>
      this.db.run(
        "UPDATE items SET title=?,html=?,plain=?,document_json=?,updated_at=? WHERE id=?",
        [
          String(patch.title ?? item.title)
            .trim()
            .slice(0, 500) || "未命名笔记",
          html,
          plainText(html),
          json,
          now(),
          id,
        ],
      ),
    );
    return this.get(id);
  }
  open(id) {
    this.get(id);
    this.transaction(() =>
      this.db.run("UPDATE items SET opened_at=? WHERE id=?", [now(), id]),
    );
  }
  favorite(id) {
    this.get(id);
    this.transaction(() =>
      this.db.run("UPDATE items SET favorite=1-favorite WHERE id=?", [id]),
    );
  }
  trash(id, restore = false) {
    this.get(id);
    this.transaction(() =>
      this.db.run("UPDATE items SET deleted_at=? WHERE id=?", [
        restore ? null : now(),
        id,
      ]),
    );
  }
  purge(ids) {
    this.transaction(() => {
      for (const id of ids) {
        if (!this.get(id).deleted_at)
          throw new Error("只能永久删除回收站中的资料");
        this.db.run("DELETE FROM items WHERE id=?", [id]);
      }
    });
  }
  tags() {
    return this.rows(
      `SELECT t.*,COUNT(i.id) count FROM tags t LEFT JOIN item_tags it ON it.tag_id=t.id LEFT JOIN items i ON i.id=it.item_id AND i.deleted_at IS NULL GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
    );
  }
  addTag(name) {
    name = String(name).trim();
    if (!name || name.length > 50) throw new Error("标签名称应为 1–50 个字符");
    const existing = this.rows(
      "SELECT * FROM tags WHERE name=? COLLATE NOCASE",
      [name],
    )[0];
    if (existing) return existing;
    const id = randomUUID();
    this.transaction(() =>
      this.db.run("INSERT INTO tags VALUES(?,?)", [id, name]),
    );
    return { id, name };
  }
  renameTag(id, name) {
    name = String(name).trim();
    if (!name || name.length > 50) throw new Error("标签名称应为 1–50 个字符");
    this.transaction(() =>
      this.db.run("UPDATE tags SET name=? WHERE id=?", [name, id]),
    );
  }
  deleteTag(id) {
    this.transaction(() => this.db.run("DELETE FROM tags WHERE id=?", [id]));
  }
  mergeTag(source, target) {
    if (source === target || !this.tags().some((t) => t.id === target))
      throw new Error("请选择另一个目标标签");
    this.transaction(() => {
      this.db.run(
        "INSERT OR IGNORE INTO item_tags SELECT item_id,? FROM item_tags WHERE tag_id=?",
        [target, source],
      );
      this.db.run("DELETE FROM tags WHERE id=?", [source]);
    });
  }
  setTags(id, tags) {
    this.get(id);
    this.transaction(() => {
      this.db.run("DELETE FROM item_tags WHERE item_id=?", [id]);
      for (const tag of new Set(tags))
        this.db.run("INSERT INTO item_tags VALUES(?,?)", [id, tag]);
    });
  }
  folders() {
    return this.rows(
      `SELECT f.*,COUNT(i.id) count FROM folders f LEFT JOIN items i ON i.folder_id=f.id AND i.deleted_at IS NULL GROUP BY f.id ORDER BY f.name COLLATE NOCASE`,
    );
  }
  folder(id) {
    const folder = this.rows("SELECT * FROM folders WHERE id=?", [id])[0];
    if (!folder) throw new Error("文件夹不存在");
    return folder;
  }
  folderName(name) {
    name = String(name).trim();
    if (
      !name ||
      name.length > 80 ||
      /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
      name === "." ||
      name === ".."
    )
      throw new Error("文件夹名称应为 1–80 个字符，不能含路径分隔符或特殊字符");
    return name;
  }
  addFolder(name, parentId = null) {
    name = this.folderName(name);
    if (parentId) this.folder(parentId);
    if (
      this.rows(
        "SELECT id FROM folders WHERE parent_id IS ? AND name=? COLLATE NOCASE",
        [parentId, name],
      ).length
    )
      throw new Error("同级已有同名文件夹");
    const id = randomUUID();
    this.transaction(() =>
      this.db.run("INSERT INTO folders VALUES(?,?,?,?)", [
        id,
        name,
        parentId,
        now(),
      ]),
    );
    return this.folder(id);
  }
  renameFolder(id, name) {
    const folder = this.folder(id);
    name = this.folderName(name);
    if (
      this.rows(
        "SELECT id FROM folders WHERE parent_id IS ? AND name=? COLLATE NOCASE AND id<>?",
        [folder.parent_id, name, id],
      ).length
    )
      throw new Error("同级已有同名文件夹");
    this.transaction(() =>
      this.db.run("UPDATE folders SET name=? WHERE id=?", [name, id]),
    );
  }
  folderDescendants(id) {
    this.folder(id);
    return this.rows(
      "WITH RECURSIVE tree(id) AS (SELECT id FROM folders WHERE id=? UNION SELECT f.id FROM folders f JOIN tree t ON f.parent_id=t.id) SELECT id FROM tree",
      [id],
    ).map((row) => row.id);
  }
  deleteFolder(id) {
    const folder = this.folder(id),
      descendants = this.folderDescendants(id);
    this.transaction(() => {
      for (const child of descendants)
        this.db.run("UPDATE items SET folder_id=? WHERE folder_id=?", [
          folder.parent_id,
          child,
        ]);
      for (const child of descendants.reverse())
        this.db.run("DELETE FROM folders WHERE id=?", [child]);
    });
    return folder.parent_id;
  }
  moveItem(id, folderId = null) {
    const item = this.get(id);
    if (item.deleted_at) throw new Error("请先恢复回收站中的资料");
    if (folderId) this.folder(folderId);
    this.transaction(() =>
      this.db.run("UPDATE items SET folder_id=? WHERE id=?", [folderId, id]),
    );
    return this.get(id);
  }
  list(filters = {}) {
    const args = [],
      clauses = [
        filters.view === "trash"
          ? "i.deleted_at IS NOT NULL"
          : "i.deleted_at IS NULL",
      ];
    if (filters.folderId) {
      const folders = this.folderDescendants(filters.folderId);
      // Browsing shows direct children; a query searches the complete subtree.
      if (String(filters.query || "").trim()) {
        clauses.push(`i.folder_id IN (${folders.map(() => "?").join(",")})`);
        args.push(...folders);
      } else {
        clauses.push("i.folder_id=?");
        args.push(filters.folderId);
      }
    }
    if (filters.view === "recent") clauses.push("i.opened_at IS NOT NULL");
    if (filters.view === "favorites" || filters.favorite)
      clauses.push("i.favorite=1");
    if (filters.view === "untagged")
      clauses.push("NOT EXISTS(SELECT 1 FROM item_tags WHERE item_id=i.id)");
    if (["note", "pdf", "image"].includes(filters.kind)) {
      clauses.push("i.kind=?");
      args.push(filters.kind);
    }
    for (const tag of filters.tags || []) {
      clauses.push(
        "EXISTS(SELECT 1 FROM item_tags WHERE item_id=i.id AND tag_id=?)",
      );
      args.push(tag);
    }
    const q = String(filters.query || "")
      .trim()
      .toLowerCase();
    const match = "instr(lower(text),?)>0";
    if (q) {
      clauses.push(
        `(instr(lower(i.title),?)>0 OR instr(lower(i.plain),?)>0 OR EXISTS(SELECT 1 FROM tags t JOIN item_tags it ON t.id=it.tag_id WHERE it.item_id=i.id AND instr(lower(t.name),?)>0) OR EXISTS(SELECT 1 FROM pdf_pages WHERE item_id=i.id AND ${match}))`,
      );
      args.push(q, q, q, q);
    }
    const order =
      filters.view === "recent"
        ? "i.opened_at DESC"
        : { created: "i.created_at DESC", title: "i.title COLLATE NOCASE" }[
            filters.sort
          ] || "i.updated_at DESC";
    const total = this.rows(
      `SELECT COUNT(*) total FROM items i WHERE ${clauses.join(" AND ")}`,
      args,
    )[0].total;
    const limit = Math.min(200, Math.max(1, Number(filters.limit) || 100));
    const offset = Math.max(0, Number(filters.offset) || 0);
    const rows = this.rows(
      `SELECT i.id,i.kind,i.title,i.folder_id,i.favorite,i.created_at,i.updated_at,i.opened_at,i.deleted_at,i.index_status,substr(i.plain,1,250) preview FROM items i WHERE ${clauses.join(" AND ")} ORDER BY ${order},i.id LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );
    // Retrieve long text only for visible results, avoiding transferring entire documents to the UI.
    for (const item of rows) {
      item.tags = this.rows(
        "SELECT t.* FROM tags t JOIN item_tags it ON t.id=it.tag_id WHERE it.item_id=?",
        [item.id],
      );
      item.hit_page = null;
      if (q) {
        const body = this.rows("SELECT plain FROM items WHERE id=?", [
          item.id,
        ])[0].plain;
        const page = this.rows(
          `SELECT page,text FROM pdf_pages WHERE item_id=? AND ${match} ORDER BY page LIMIT 1`,
          [item.id, q],
        )[0];
        const source = body.toLowerCase().includes(q)
          ? body
          : page?.text ||
            item.tags.map((t) => t.name).join(" · ") ||
            item.title;
        const position = Math.max(0, source.toLowerCase().indexOf(q));
        item.preview =
          (position > 35 ? "…" : "") +
          source.slice(Math.max(0, position - 35), position + q.length + 95);
        item.hit_page = page?.page ?? null;
      }
    }
    return { items: rows, total };
  }
  stats() {
    return this.rows(
      `SELECT COUNT(*) total,SUM(kind='note' AND deleted_at IS NULL) notes,SUM(kind='pdf' AND deleted_at IS NULL) pdfs,SUM(kind='image' AND deleted_at IS NULL) images,SUM(deleted_at IS NOT NULL) trash FROM items`,
    )[0];
  }
  assetPath(name) {
    if (!ASSET.test(String(name))) throw new Error("无效资源路径");
    return path.join(this.root, "assets", name);
  }
  copyAsset(source) {
    const ext = path.extname(source).toLowerCase();
    if (ext !== ".pdf" && !imageTypes.has(ext))
      throw new Error("不支持的文件格式");
    if (fs.statSync(source).size > 200 * 1024 * 1024)
      throw new Error("单个文件不能超过 200 MB");
    const name = randomUUID() + ext;
    fs.copyFileSync(source, this.assetPath(name), fs.constants.COPYFILE_EXCL);
    return name;
  }
  importFile(source, folderId = null) {
    if (folderId) this.folder(folderId);
    const ext = path.extname(source).toLowerCase(),
      title = path.basename(source, ext);
    if (ext === ".md" || ext === ".markdown") {
      if (fs.statSync(source).size > 10 * 1024 * 1024)
        throw new Error("Markdown 文件不能超过 10 MB");
      let html = marked.parse(fs.readFileSync(source, "utf8"), {
        async: false,
      });
      const warnings = [];
      html = html.replace(/<img\b[^>]*src="([^"]+)"[^>]*>/g, (tag, src) => {
        try {
          if (/^[a-z]+:|^\/\//i.test(src)) throw new Error("外部图片");
          const image = path.resolve(
            path.dirname(source),
            decodeURIComponent(src.replace(/&amp;/g, "&")),
          );
          if (!imageTypes.has(path.extname(image).toLowerCase()))
            throw new Error("图片格式");
          return tag.replace(src, "kbasset://asset/" + this.copyAsset(image));
        } catch {
          warnings.push("未导入图片：" + src);
          return "<p>[图片未导入]</p>";
        }
      });
      return {
        item: this.create(title, html, "note", null, folderId),
        warnings,
      };
    }
    const asset = this.copyAsset(source);
    return {
      item: this.create(
        title,
        "",
        ext === ".pdf" ? "pdf" : "image",
        asset,
        folderId,
      ),
      warnings: [],
    };
  }
  pendingPdfs() {
    return this.rows(
      "SELECT id,asset FROM items WHERE kind='pdf' AND index_status='pending'",
    );
  }
  indexPdf(id, pages, error = "") {
    if (!this.rows("SELECT id FROM items WHERE id=?", [id]).length) return;
    this.transaction(() => {
      this.db.run("DELETE FROM pdf_pages WHERE item_id=?", [id]);
      for (let i = 0; i < pages.length; i++)
        this.db.run("INSERT INTO pdf_pages VALUES(?,?,?)", [
          id,
          i + 1,
          pages[i],
        ]);
      const hasText = pages.some((t) => t.trim());
      this.db.run("UPDATE items SET index_status=?,index_error=? WHERE id=?", [
        hasText ? "ready" : "unavailable",
        error ||
          (hasText ? "" : "未检测到文字，可能为扫描 PDF；仍可正常阅读。"),
        id,
      ]);
    });
  }
  backup(destination) {
    const files = { "library.sqlite": this.db.export() };
    for (const name of fs.readdirSync(path.join(this.root, "assets")))
      if (ASSET.test(name))
        files["assets/" + name] = new Uint8Array(
          fs.readFileSync(this.assetPath(name)),
        );
    const size = Object.values(files).reduce(
      (sum, data) => sum + data.length,
      0,
    );
    if (size > MAX_ARCHIVE)
      throw new Error("V1 备份包暂限 512 MB，请先减少资料体积");
    const manifest = {
      app: "shizhi",
      version: 1,
      createdAt: now(),
      files: Object.fromEntries(
        Object.entries(files).map(([name, data]) => [name, sha(data)]),
      ),
    };
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    atomicWrite(destination, zipSync(files, { level: 1 }));
    return destination;
  }
  autoBackup(date = new Date()) {
    const day = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    fs.mkdirSync(this.backupDir, { recursive: true });
    const destination = path.join(this.backupDir, "auto-" + day + ".szkb");
    if (!fs.existsSync(destination)) this.backup(destination);
    const files = fs
      .readdirSync(this.backupDir)
      .filter((n) => /^auto-\d{4}-\d{2}-\d{2}\.szkb$/.test(n))
      .sort()
      .reverse();
    for (const old of files.slice(7))
      fs.unlinkSync(path.join(this.backupDir, old));
    return destination;
  }
  restore(source) {
    if (fs.statSync(source).size > MAX_ARCHIVE) throw new Error("备份包过大");
    let expanded = 0,
      count = 0;
    const files = unzipSync(new Uint8Array(fs.readFileSync(source)), {
      filter: (file) => {
        expanded += file.originalSize;
        count++;
        if (expanded > MAX_ARCHIVE + 8 * 1024 * 1024 || count > 50000)
          throw new Error("备份解压体积超出限制");
        if (
          file.name !== "manifest.json" &&
          file.name !== "library.sqlite" &&
          !(file.name.startsWith("assets/") && ASSET.test(file.name.slice(7)))
        )
          throw new Error("备份包含无效路径");
        return true;
      },
    });
    const manifest = JSON.parse(
      strFromU8(files["manifest.json"] || new Uint8Array()),
    );
    if (
      manifest.app !== "shizhi" ||
      manifest.version !== 1 ||
      !manifest.files ||
      !manifest.files["library.sqlite"]
    )
      throw new Error("不支持的备份格式");
    const names = Object.keys(files).filter((n) => n !== "manifest.json");
    if (names.length !== Object.keys(manifest.files).length)
      throw new Error("备份文件清单不一致");
    for (const name of names)
      if (sha(files[name]) !== manifest.files[name])
        throw new Error("备份校验失败：" + name);
    const candidate = new SQL.Database(files["library.sqlite"]);
    try {
      validDatabase(candidate);
      const rows =
        candidate.exec("SELECT asset,html FROM items")[0]?.values || [];
      for (const [asset, html] of rows) {
        const referenced = [
          ...String(html).matchAll(
            /kbasset:\/\/asset\/([a-f0-9-]{36}\.(?:pdf|png|jpg|jpeg|gif|webp))/g,
          ),
        ].map((m) => m[1]);
        if (asset) referenced.push(asset);
        for (const name of referenced)
          if (!ASSET.test(name) || !files["assets/" + name])
            throw new Error("备份缺少附件：" + name);
      }
      upgradeFolders(candidate);
      files["library.sqlite"] = candidate.export();
    } finally {
      candidate.close();
    }
    fs.mkdirSync(this.backupDir, { recursive: true });
    const safety = this.backup(
      path.join(this.backupDir, "before-restore-" + Date.now() + ".szkb"),
    );
    const stage = this.root + ".restore-" + randomUUID(),
      previous = this.root + ".rollback-" + randomUUID();
    fs.mkdirSync(path.join(stage, "assets"), { recursive: true });
    try {
      for (const name of names)
        atomicWrite(path.join(stage, name), files[name]);
      atomicWrite(
        this.root + ".restore-journal.json",
        JSON.stringify({ root: this.root, stage, previous }),
      );
      fs.renameSync(this.root, previous);
      try {
        fs.renameSync(stage, this.root);
      } catch (error) {
        fs.renameSync(previous, this.root);
        throw error;
      }
      const old = this.db;
      this.db = new SQL.Database(files["library.sqlite"]);
      this.db.run("PRAGMA foreign_keys=ON");
      old.close();
      fs.unlinkSync(this.root + ".restore-journal.json");
      // Keep the swapped directory as an additional recovery copy; never recursively delete user data during restore.
      return { safety, previous };
    } catch (error) {
      if (fs.existsSync(previous) && !fs.existsSync(this.root))
        fs.renameSync(previous, this.root);
      throw error;
    }
  }
  exportNote(id, destination) {
    const item = this.get(id);
    if (item.kind !== "note") throw new Error("仅笔记支持 Markdown 导出");
    const converter = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    converter.use(gfm);
    const resources = [
      ...new Set(
        [
          ...item.html.matchAll(
            /kbasset:\/\/asset\/([a-f0-9-]{36}\.(?:pdf|png|jpg|jpeg|gif|webp))/g,
          ),
        ].map((m) => m[1]),
      ),
    ];
    const files = {};
    let html = item.html;
    for (const name of resources) {
      files["images/" + name] = new Uint8Array(
        fs.readFileSync(this.assetPath(name)),
      );
      html = html.replaceAll("kbasset://asset/" + name, "images/" + name);
    }
    files["note.md"] = strToU8(
      "# " + item.title + "\n\n" + converter.turndown(html),
    );
    files["metadata.json"] = strToU8(
      JSON.stringify(
        {
          title: item.title,
          tags: item.tags.map((t) => t.name),
          createdAt: item.created_at,
        },
        null,
        2,
      ),
    );
    atomicWrite(destination, zipSync(files));
    return destination;
  }
  close() {
    this.db.close();
  }
}
