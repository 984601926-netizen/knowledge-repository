import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { Library, atomicWrite, cleanHtml } from "../electron/store.mjs";
import { PNG, writePdf, writeChinesePdf } from "./fixtures.mjs";
import { pdfOptions } from "../electron/pdf-options.mjs";

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shizhi-test-"));
  const store = new Library(path.join(dir, "library"));
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store };
}
test("中文内容、标签、AND 组合、排序及打开时间互不干扰", (t) => {
  const { store } = setup(t);
  const note = store.create("知识管理", "<p>积累中文检索经验</p>"),
    second = store.create("另一个笔记");
  const a = store.addTag("研究"),
    b = store.addTag("方法");
  store.setTags(note.id, [a.id, b.id]);
  store.setTags(second.id, [a.id]);
  assert.equal(store.list({ query: "中文检索" }).items[0].id, note.id);
  assert.equal(store.list({ query: "研究" }).total, 2);
  assert.equal(store.list({ tags: [a.id, b.id] }).total, 1);
  assert.equal(store.list({ query: "' OR 1=1 --" }).total, 0);
  store.open(note.id);
  assert.equal(store.get(note.id).updated_at, note.updated_at);
  assert.equal(store.list({ view: "recent" }).total, 1);
  store.save(note.id, {
    title: "已修改",
    html: "<p>重新保存</p>",
    document_json: { type: "doc" },
  });
  const reopened = new Library(store.root);
  assert.equal(reopened.get(note.id).title, "已修改");
  assert.equal(reopened.get(note.id).tags.length, 2);
  reopened.close();
});
test("回收站、永久删除、标签合并与外键清理", (t) => {
  const { store } = setup(t),
    item = store.create("保留资料"),
    a = store.addTag("旧标签"),
    b = store.addTag("新标签");
  store.setTags(item.id, [a.id, b.id]);
  store.mergeTag(a.id, b.id);
  assert.equal(store.get(item.id).tags.length, 1);
  store.deleteTag(b.id);
  assert.equal(store.get(item.id).tags.length, 0);
  assert.equal(store.rows("SELECT * FROM item_tags").length, 0);
  assert.equal(store.list({ view: "untagged" }).total, 1);
  store.trash(item.id);
  assert.equal(store.list().total, 0);
  assert.equal(store.list({ view: "trash" }).total, 1);
  assert.throws(() => store.save(item.id, { title: "不应更新" }));
  store.trash(item.id, true);
  assert.equal(store.list().total, 1);
  assert.throws(() => store.purge([item.id]));
  store.trash(item.id);
  store.purge([item.id]);
  assert.throws(() => store.get(item.id));
});
test("磁盘写入失败回滚内存与磁盘，重试可保存", (t) => {
  const { store } = setup(t),
    item = store.create("原始标题", "<p>原始正文</p>");
  store.write = () => {
    throw new Error("ENOSPC simulated");
  };
  assert.throws(
    () =>
      store.save(item.id, {
        title: "未保存标题",
        html: "<p>不能丢失上次内容</p>",
      }),
    /保存失败/,
  );
  assert.equal(store.get(item.id).title, "原始标题");
  const reopened = new Library(store.root);
  assert.equal(reopened.get(item.id).title, "原始标题");
  reopened.close();
  store.write = atomicWrite;
  store.save(item.id, { title: "重试成功" });
  assert.equal(store.get(item.id).title, "重试成功");
});
test("导入复制附件、Markdown 本地图片、安全过滤及单条导出", (t) => {
  const { store, dir } = setup(t),
    source = path.join(dir, "source.png"),
    markdown = path.join(dir, "example.md");
  fs.writeFileSync(source, PNG);
  fs.writeFileSync(
    markdown,
    "# 标题\n\n笔记正文\n\n![本地图片](source.png)\n\n<script>alert(1)</script>\n\n![远程图片](https://example.com/a.png)",
  );
  const imported = store.importFile(markdown);
  assert.equal(imported.warnings.length, 1);
  assert.match(imported.item.html, /kbasset:\/\/asset\//);
  assert.doesNotMatch(imported.item.html, /script|https:\/\/example/);
  const image = store.importFile(source).item;
  fs.unlinkSync(source);
  assert.ok(fs.existsSync(store.assetPath(image.asset)));
  const destination = path.join(dir, "note.zip");
  store.exportNote(imported.item.id, destination);
  const files = unzipSync(fs.readFileSync(destination));
  assert.match(strFromU8(files["note.md"]), /images\//);
  assert.equal(
    Object.keys(files).filter((n) => n.startsWith("images/")).length,
    1,
  );
  assert.throws(() => store.assetPath("../library.sqlite"));
  assert.doesNotMatch(
    cleanHtml(
      '<img src="file:///secret"><a href="javascript:alert(1)">link</a>',
    ),
    /file:|javascript:/,
  );
});
test("PDF 真实文字提取、中文页索引及搜索命中页", async (t) => {
  const { store, dir } = setup(t),
    source = path.join(dir, "document.pdf");
  writePdf(source, ["Page one", "Searchable knowledge"]);
  const item = store.importFile(source).item;
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(fs.readFileSync(store.assetPath(item.asset))),
    ...pdfOptions,
  });
  try {
    const pdf = await task.promise,
      text = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      text.push(
        (await page.getTextContent()).items.map((t) => t.str || "").join(" "),
      );
    }
    assert.match(text[1], /Searchable knowledge/);
    text[1] += " 中文科学资料";
    store.indexPdf(item.id, text);
    assert.equal(store.list({ query: "中文科学" }).items[0].hit_page, 2);
    assert.equal(store.get(item.id).index_status, "ready");
    store.indexPdf(item.id, []);
    assert.equal(store.get(item.id).index_status, "unavailable");
  } finally {
    await task.destroy();
  }
});
test("中文 CID 字体 PDF 使用离线 CMap 提取原文并搜索", async (t) => {
  const { store, dir } = setup(t),
    source = path.join(dir, "中文.pdf");
  writeChinesePdf(source);
  const item = store.importFile(source).item,
    { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(fs.readFileSync(store.assetPath(item.asset))),
    ...pdfOptions,
  });
  try {
    const pdf = await task.promise,
      page = await pdf.getPage(1),
      content = await page.getTextContent(),
      text = content.items.map((t) => t.str || "").join("");
    assert.match(text, /中文科学资料/);
    store.indexPdf(item.id, [text]);
    assert.equal(store.list({ query: "科学资料" }).items[0].hit_page, 1);
  } finally {
    await task.destroy();
  }
});
test("完整备份可恢复到空目录，损坏与恶意路径备份不会覆盖现有数据", (t) => {
  const { store, dir } = setup(t);
  fs.writeFileSync(path.join(dir, "image.png"), PNG);
  const image = store.importFile(path.join(dir, "image.png")).item,
    item = store.create(
      "带图片的笔记",
      `<p>正文</p><img src="kbasset://asset/${image.asset}">`,
    ),
    tag = store.addTag("备份标签");
  store.setTags(item.id, [tag.id]);
  const zip = store.backup(path.join(dir, "backup.szkb"));
  const fresh = new Library(path.join(dir, "fresh"));
  try {
    const result = fresh.restore(zip);
    assert.ok(fs.existsSync(result.safety));
    assert.equal(fresh.get(item.id).tags[0].name, "备份标签");
    assert.ok(fs.existsSync(fresh.assetPath(image.asset)));
    const files = unzipSync(fs.readFileSync(zip));
    files["library.sqlite"][0] ^= 1;
    fs.writeFileSync(path.join(dir, "corrupt.szkb"), zipSync(files));
    assert.throws(
      () => fresh.restore(path.join(dir, "corrupt.szkb")),
      /校验失败/,
    );
    assert.equal(fresh.get(item.id).title, "带图片的笔记");
    files["../escape"] = strToU8("bad");
    fs.writeFileSync(path.join(dir, "evil.szkb"), zipSync(files));
    assert.throws(() => fresh.restore(path.join(dir, "evil.szkb")), /无效路径/);
  } finally {
    fresh.close();
  }
});
test("自动备份每天一份，滚动保留 7 份，手动备份不受影响", (t) => {
  const { store } = setup(t);
  store.create("备份资料");
  fs.mkdirSync(store.backupDir, { recursive: true });
  store.backup(path.join(store.backupDir, "manual.szkb"));
  for (let i = 1; i <= 10; i++) store.autoBackup(new Date(2026, 10, i));
  store.autoBackup(new Date(2026, 10, 10));
  const files = fs.readdirSync(store.backupDir);
  assert.equal(files.filter((n) => n.startsWith("auto-")).length, 7);
  assert.ok(files.includes("manual.szkb"));
});
test("损坏主数据库可从前一份保存恢复，原损坏文件保留", (t) => {
  const { store } = setup(t),
    note = store.create("可恢复内容");
  store.save(note.id, { title: "最新内容" });
  fs.writeFileSync(path.join(store.root, "library.sqlite"), "broken database");
  const recovered = new Library(store.root);
  assert.match(recovered.warning, /已恢复/);
  assert.equal(recovered.get(note.id).title, "可恢复内容");
  recovered.close();
});
test("恢复时进程在目录切换间退出，重新启动自动找回原知识库", (t) => {
  const { store } = setup(t),
    note = store.create("恢复中断仍保留");
  const previous = store.root + ".rollback-" + randomUUID(),
    stage = store.root + ".restore-" + randomUUID();
  fs.mkdirSync(stage);
  atomicWrite(
    store.root + ".restore-journal.json",
    JSON.stringify({ root: store.root, previous, stage }),
  );
  fs.renameSync(store.root, previous);
  const reopened = new Library(store.root);
  assert.equal(reopened.get(note.id).title, "恢复中断仍保留");
  assert.match(reopened.warning, /恢复过程曾中断/);
  reopened.close();
});
test("5000 条资料含中文正文和标签的搜索返回低于 1 秒", (t) => {
  const { store } = setup(t),
    stamp = new Date().toISOString();
  store.transaction(() => {
    for (let i = 0; i < 5000; i++)
      store.db.run(
        "INSERT INTO items(id,kind,title,html,plain,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        [
          randomUUID(),
          "note",
          "知识条目 " + i,
          "<p>科学资料</p>",
          "科学资料与阅读笔记 " + i,
          stamp,
          stamp,
        ],
      );
  });
  const start = performance.now(),
    result = store.list({ query: "科学资料" }),
    elapsed = performance.now() - start;
  assert.equal(result.total, 5000);
  assert.equal(result.items.length, 100);
  assert.ok(elapsed < 1000, `搜索耗时 ${elapsed.toFixed(1)}ms`);
  console.log(`5000 条资料搜索：${elapsed.toFixed(1)}ms`);
});
