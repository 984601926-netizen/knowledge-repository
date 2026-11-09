import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
import { Library } from "../electron/store.mjs";
import { Preferences } from "../electron/settings.mjs";

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shizhi-v11-"));
  const library = new Library(path.join(directory, "library"));
  t.after(() => {
    library.close();
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { directory, library };
}
test("文件夹创建、同级重复、改名、导入归属与全库/当前/子树搜索", (t) => {
  const { directory, library } = setup(t),
    a = library.addFolder("科研"),
    child = library.addFolder("论文", a.id),
    other = library.addFolder("工作");
  assert.throws(() => library.addFolder("科研"), /同名/);
  assert.throws(() => library.addFolder("../非法"), /特殊/);
  library.addFolder("科研", other.id);
  assert.throws(() => library.renameFolder(other.id, "科研"), /同名/);
  const first = library.create(
      "直接资料",
      "<p>科学检索</p>",
      "note",
      null,
      a.id,
    ),
    second = library.create(
      "子层资料",
      "<p>科学检索</p>",
      "note",
      null,
      child.id,
    );
  assert.equal(library.list().total, 2);
  assert.equal(library.list({ folderId: a.id }).total, 1);
  assert.equal(library.list({ folderId: a.id, query: "科学检索" }).total, 2);
  const tag = library.addTag("共同标签");
  library.setTags(first.id, [tag.id]);
  library.setTags(second.id, [tag.id]);
  assert.equal(
    library.list({ folderId: child.id, tags: [tag.id] }).items[0].id,
    second.id,
  );
  const file = path.join(directory, "导入.md");
  fs.writeFileSync(file, "# 自动归类");
  assert.equal(library.importFile(file, child.id).item.folder_id, child.id);
  library.renameFolder(child.id, "文献");
  assert.equal(library.folder(child.id).name, "文献");
  const modified = library.get(first.id).updated_at;
  library.moveItem(first.id, child.id);
  assert.equal(library.get(first.id).updated_at, modified);
  assert.throws(() => library.moveItem(first.id, randomUUID()), /不存在/);
});
test("删除嵌套文件夹保留全部资料、标签及回收站状态，移动至上级", (t) => {
  const { library } = setup(t),
    parent = library.addFolder("上级"),
    folder = library.addFolder("待删除", parent.id),
    child = library.addFolder("子层", folder.id);
  const note = library.create(
      "保留正文",
      "<p>内容</p>",
      "note",
      null,
      child.id,
    ),
    tag = library.addTag("标签");
  library.setTags(note.id, [tag.id]);
  library.trash(note.id);
  assert.equal(library.deleteFolder(folder.id), parent.id);
  assert.equal(library.get(note.id).folder_id, parent.id);
  assert.ok(library.get(note.id).deleted_at);
  assert.equal(library.get(note.id).tags[0].id, tag.id);
  assert.equal(library.get(note.id).html, "<p>内容</p>");
  library.deleteFolder(parent.id);
  assert.equal(library.get(note.id).folder_id, null);
  assert.equal(library.folders().length, 0);
});
test("文件夹改动写入失败时回滚，重启与备份恢复保留层级和归属", (t) => {
  const { directory, library } = setup(t),
    root = library.addFolder("根"),
    child = library.addFolder("子", root.id),
    note = library.create("资料", "", "note", null, child.id);
  const original = library.write;
  library.write = () => {
    throw new Error("ENOSPC");
  };
  assert.throws(() => library.deleteFolder(root.id), /保存失败/);
  assert.equal(library.folders().length, 2);
  assert.equal(library.get(note.id).folder_id, child.id);
  library.write = original;
  const reopened = new Library(library.root);
  assert.equal(reopened.get(note.id).folder_id, child.id);
  reopened.close();
  const backup = library.backup(path.join(directory, "folder.szkb")),
    fresh = new Library(path.join(directory, "fresh"));
  try {
    fresh.restore(backup);
    assert.equal(fresh.folder(child.id).parent_id, root.id);
    assert.equal(fresh.get(note.id).folder_id, child.id);
  } finally {
    fresh.close();
  }
});
test("含循环层级的备份恢复被拒绝，现有资料不变", (t) => {
  const { directory, library } = setup(t),
    parent = library.addFolder("父"),
    child = library.addFolder("子", parent.id),
    note = library.create("保留当前数据");
  library.db.run("UPDATE folders SET parent_id=? WHERE id=?", [
    child.id,
    parent.id,
  ]);
  const file = library.backup(path.join(directory, "cyclic.szkb"));
  const fresh = new Library(path.join(directory, "fresh"));
  const existing = fresh.create("不能覆盖");
  try {
    assert.throws(() => fresh.restore(file), /循环层级/);
    assert.equal(fresh.get(existing.id).title, "不能覆盖");
  } finally {
    fresh.close();
  }
  assert.equal(library.get(note.id).title, "保留当前数据");
});
test("旧 V1 数据库自动备份并升级，旧备份也可恢复到 V1.1", async (t) => {
  const { directory, library } = setup(t),
    oldRoot = path.join(directory, "legacy");
  fs.mkdirSync(path.join(oldRoot, "assets"), { recursive: true });
  // A new library's first previous snapshot is the actual V1 schema before migration.
  const SQL = await initSqlJs(),
    db = new SQL.Database(
      fs.readFileSync(path.join(library.root, "library.sqlite.previous")),
    ),
    id = randomUUID(),
    stamp = new Date().toISOString();
  assert.equal(
    db.exec("SELECT value FROM meta WHERE key='version'")[0].values[0][0],
    "1",
  );
  db.run(
    "INSERT INTO items(id,kind,title,html,plain,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    [id, "note", "旧版资料", "<p>保持原文</p>", "保持原文", stamp, stamp],
  );
  fs.writeFileSync(path.join(oldRoot, "library.sqlite"), db.export());
  db.close();
  const upgraded = new Library(oldRoot);
  try {
    assert.equal(upgraded.get(id).title, "旧版资料");
    assert.equal(upgraded.get(id).folder_id, null);
    assert.equal(
      upgraded.rows("SELECT value FROM meta WHERE key='version'")[0].value,
      "2",
    );
    const before = fs
      .readdirSync(upgraded.backupDir)
      .find((name) => name.startsWith("before-upgrade-"));
    assert.ok(before);
    library.restore(path.join(upgraded.backupDir, before));
    assert.equal(library.get(id).title, "旧版资料");
    assert.equal(library.folders().length, 0);
    library.addFolder("恢复后可建文件夹");
  } finally {
    upgraded.close();
  }
});
test("设置保存、校验与重启读取；无效配置保留原文件并提示", (t) => {
  const { library } = setup(t),
    settings = new Preferences(library.root);
  settings.update({ theme: "dark", editorFontSize: 18, autosaveDelay: 2000 });
  assert.equal(new Preferences(library.root).value.theme, "dark");
  assert.equal(new Preferences(library.root).value.editorFontSize, 18);
  const before = fs.readFileSync(settings.file, "utf8");
  assert.throws(() => settings.update({ editorFontSize: 900 }));
  assert.throws(() => settings.update({ backupDir: "bogus" }));
  assert.equal(fs.readFileSync(settings.file, "utf8"), before);
  fs.writeFileSync(settings.file, "{broken");
  const fallback = new Preferences(library.root);
  assert.ok(fallback.warning);
  assert.equal(fs.readFileSync(settings.file, "utf8"), "{broken");
});
test("更改备份位置先完成备份，失败不切换；重启继续使用，旧备份保留", (t) => {
  const { directory, library } = setup(t),
    settings = new Preferences(library.root);
  library.create("完整资料");
  const oldBackup = library.autoBackup();
  const chosen = path.join(directory, "自定义备份"),
    result = settings.changeBackupDir(chosen, library);
  assert.ok(fs.existsSync(result.backup));
  assert.ok(fs.existsSync(oldBackup));
  assert.equal(library.backupDir, chosen);
  assert.equal(new Preferences(library.root).value.backupDir, chosen);
  library.autoBackup();
  assert.ok(fs.readdirSync(chosen).some((name) => name.startsWith("auto-")));
  assert.throws(
    () => settings.changeBackupDir(library.root, library),
    /不能位于/,
  );
  assert.throws(
    () => settings.changeBackupDir(path.join(library.root, "backups"), library),
    /不能位于/,
  );
  const bad = path.join(directory, "只是一份文件");
  fs.writeFileSync(bad, "file");
  assert.throws(() => settings.changeBackupDir(bad, library));
  assert.equal(library.backupDir, chosen);
  assert.equal(new Preferences(library.root).value.backupDir, chosen);
  const snapshot = fs.readFileSync(settings.file, "utf8");
  const persist = settings.persist;
  settings.persist = () => {
    throw new Error("配置写入失败");
  };
  assert.throws(() =>
    settings.changeBackupDir(path.join(directory, "无法提交配置"), library),
  );
  settings.persist = persist;
  assert.equal(library.backupDir, chosen);
  assert.equal(fs.readFileSync(settings.file, "utf8"), snapshot);
});
