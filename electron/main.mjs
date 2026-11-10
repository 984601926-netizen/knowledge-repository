import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  shell,
  clipboard,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Library, atomicWrite, localDay } from "./store.mjs";
import { pdfOptions } from "./pdf-options.mjs";
import { Preferences } from "./settings.mjs";
import { Habitat, epubChapters } from "./habitat.mjs";
import { Teacher } from "./teacher.mjs";
import { Social, createRelay } from "./social.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "kbasset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const profileArg = process.argv.find((a) => a.startsWith("--profile="));
if (profileArg)
  app.setPath("userData", path.resolve(profileArg.slice("--profile=".length)));
const relayMode = process.argv.includes("--relay-server");
const hasLock = relayMode || app.requestSingleInstanceLock();
if (!hasLock) app.quit();
let library,
  preferences,
  window,
  allowClose = false,
  indexing = false,
  generation = 0;
const devURL = process.env.VITE_DEV_SERVER_URL;
const rootArg = process.argv.find((a) => a.startsWith("--library="));
const uiFile = path.join(here, "../dist/index.html");
let habitat, teacher, social, worldTimer;
function services() {
  social?.close();
  for (const c of teacher?.controllers?.values() || []) c.abort();
  habitat = new Habitat(library);
  teacher = new Teacher(habitat);
  social = new Social(habitat);
}

async function indexPdfs() {
  if (indexing) return;
  indexing = true;
  const version = generation;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    for (const item of library.pendingPdfs()) {
      if (version !== generation) break;
      let pdf, task;
      try {
        task = getDocument({
          data: new Uint8Array(fs.readFileSync(library.assetPath(item.asset))),
          ...pdfOptions,
        });
        pdf = await task.promise;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          if (version !== generation) break;
          const page = await pdf.getPage(pageNumber),
            content = await page.getTextContent();
          pages.push(
            content.items
              .map((t) => ("str" in t ? t.str + (t.hasEOL ? "\n" : "") : ""))
              .join(" "),
          );
          page.cleanup();
          await new Promise((resolve) => setImmediate(resolve));
        }
        if (version === generation) {
          const outline = [];
          const walk = async (entries, level = 0) => {
            for (const entry of entries || []) {
              if (outline.length >= 1000 || level > 12) break;
              let dest = entry.dest;
              if (typeof dest === "string")
                dest = await pdf.getDestination(dest);
              let page = 1;
              if (Array.isArray(dest)) {
                try {
                  page =
                    typeof dest[0] === "number"
                      ? dest[0] + 1
                      : (await pdf.getPageIndex(dest[0])) + 1;
                } catch {}
              }
              outline.push({
                title: String(entry.title || "章节").slice(0, 200),
                page: Math.max(1, Math.min(pdf.numPages, page)),
                level,
              });
              await walk(entry.items, level + 1);
            }
          };
          try {
            await walk(await pdf.getOutline());
          } catch {}
          if (version === generation) {
            library.indexPdf(item.id, pages);
            habitat.setState("pdf-outline:" + item.id, outline);
          }
        }
      } catch (error) {
        if (version === generation) {
          try {
            library.indexPdf(item.id, [], "无法提取文字：" + error.message);
          } catch (writeError) {
            console.error(writeError);
            break;
          }
        }
      } finally {
        await task?.destroy().catch(() => {});
      }
    }
  } catch (error) {
    console.error("PDF 索引异常", error);
  } finally {
    indexing = false;
    if (version !== generation) void indexPdfs();
  }
}
function requireText(value, max = 500) {
  if (typeof value !== "string" || value.length > max)
    throw new Error("无效参数");
  return value;
}
function id(value) {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error("无效标识");
  return value;
}
async function importPaths(paths, folderId = null) {
  if (folderId) library.folder(id(folderId));
  if (!Array.isArray(paths) || paths.length > 500)
    throw new Error("一次最多导入 500 个文件");
  const results = [];
  for (const source of paths) {
    try {
      if (fs.statSync(requireText(source, 10000)).size > 200 * 1024 * 1024)
        throw Error("单个文件不能超过 200 MB");
      let epub;
      if (path.extname(String(source)).toLowerCase() === ".epub")
        epub = epubChapters(fs.readFileSync(requireText(source, 10000)));
      const imported = library.importFile(requireText(source, 10000), folderId);
      if (epub)
        library.indexPdf(
          imported.item.id,
          epub.map((c) => c.text),
        );
      results.push({
        name: path.basename(source),
        ...imported,
        ok: true,
      });
    } catch (error) {
      results.push({
        name: path.basename(String(source)),
        ok: false,
        error: error.message,
      });
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  void indexPdfs();
  return results;
}
function isTrusted(sender) {
  const url = sender.getURL();
  return devURL ? url === devURL + "/" : url === pathToFileURL(uiFile).href;
}
ipcMain.handle("knowledge", async (event, action, payload = {}) => {
  if (
    !window ||
    event.sender !== window.webContents ||
    !isTrusted(event.sender)
  )
    throw new Error("拒绝非应用页面调用");
  if (typeof action !== "string") throw Error("无效操作");
  if (action.startsWith("world:")) {
    const operation = action.slice(6);
    let result;
    switch (operation) {
      case "state":
        return {
          ...habitat.snapshot(),
          social: social.snapshot(),
          warning: library.warning,
          focusRewards: habitat.getState("reward_queue") || [],
        };
      case "reward-ack":
        habitat.setState(
          "reward_queue",
          (habitat.getState("reward_queue") || []).filter(
            (r) => r.eventId !== payload.id,
          ),
        );
        return true;
      case "session":
        return habitat.session(payload);
      case "teacher-info":
        return teacher.info();
      case "teacher-config":
        return teacher.configure(payload);
      case "teacher-cancel":
        return teacher.cancel(payload.requestId);
      case "chat":
      case "extract":
      case "assess":
        result = await teacher.run(operation, payload);
        break;
      case "point-confirm":
        result = habitat.confirmPoint(payload);
        break;
      case "point-discard": {
        const p = habitat.point(id(payload.id));
        if (p.state !== "draft") throw Error("只能丢弃尚未确认的草稿");
        const answer = await dialog.showMessageBox(window, {
          type: "question",
          message: "丢弃这条知识点草稿？",
          detail: "只移除此草稿，其下的知识点会保留。",
          buttons: ["取消", "丢弃草稿"],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response !== 1) return false;
        library.transaction(() => {
          library.db.run(
            "UPDATE learning_points SET parent_id=NULL WHERE parent_id=?",
            [p.id],
          );
          library.db.run("DELETE FROM learning_points WHERE id=?", [p.id]);
        });
        result = true;
        break;
      }
      case "privacy":
        result = habitat.setPrivacy(payload);
        break;
      case "chapters":
        return habitat.chapters(id(payload.id));
      case "epub-bytes":
        if (!payload.bytes || payload.bytes.length > 200 * 1024 * 1024)
          throw Error("无效电子书");
        return epubChapters(payload.bytes);
      case "progress":
        return habitat.progress(payload);
      case "reading-pulse":
        return habitat.readingPulse(id(payload.id));
      case "focus-start":
        result = habitat.startFocus(payload);
        break;
      case "focus-control":
        result = habitat.focusControl(payload.action);
        break;
      case "garden":
        result = habitat.garden(payload.action, payload);
        break;
      case "social-connect":
        return social.connect(payload.url);
      case "social-disconnect":
        social.disconnect();
        return true;
      case "social-local":
        return social.local();
      case "copy-code":
        clipboard.writeText(social.snapshot().code);
        return true;
      case "social-add":
        return social.add(payload.code);
      case "social-accept":
        return social.accept(payload.id);
      case "social-invite":
        return social.invite(payload.id);
      case "social-join":
        return social.join(payload.id);
      case "social-leave":
        return social.leave();
      case "social-pose":
        social.pose = {
          x: Math.max(2, Math.min(98, Number(payload.x) || 50)),
          scene: payload.scene === "home" ? "home" : "garden",
        };
        social.publish();
        return true;
      case "activity":
        social.pose.seated = !!payload.seated;
        social.publish();
        return true;
      case "social-document":
        return social.document(payload.id, payload.page);
      case "social-catalog":
        if (!social.hostId) throw Error("未进入好友家园");
        return social.request(social.hostId, {
          type: "catalog",
          query: payload.query,
          offset: payload.offset,
        });
      case "social-point":
        if (!social.hostId) throw Error("未进入好友家园");
        return social.request(social.hostId, { type: "point", id: payload.id });
      case "social-file":
        return social.file(payload.id, payload.asset);
      case "social-download": {
        const file = await social.file(payload.id);
        const chosen = await dialog.showSaveDialog(window, {
          title: "保存好友共享原文",
          defaultPath:
            String(file.title).replace(/[<>:"/\\|?*]/g, "_") + "." + file.ext,
        });
        if (chosen.canceled) return null;
        atomicWrite(chosen.filePath, file.bytes);
        return chosen.filePath;
      }
      case "word-open": {
        const item = library.get(id(payload.id));
        if (item.kind !== "word" || item.deleted_at)
          throw Error("不是可打开的 Word 资料");
        const message = await shell.openPath(library.assetPath(item.asset));
        if (message) throw Error(message);
        return true;
      }
      default:
        throw Error("不支持的家园操作");
    }
    social.publish();
    return result;
  }
  switch (action) {
    case "info":
      return {
        root: library.root,
        backupDir: library.backupDir,
        warning: library.warning,
        version: app.getVersion(),
        preferences: { ...preferences.value },
      };
    case "list":
      return {
        ...library.list(payload),
        tags: library.tags(),
        stats: library.stats(),
        folders: library.folders(),
      };
    case "get":
      return library.get(id(payload.id));
    case "create":
      return library.create(
        "",
        "",
        "note",
        null,
        payload.folderId ? id(payload.folderId) : null,
      );
    case "settings-update":
      return preferences.update(payload);
    case "backup-location": {
      const chosen = await dialog.showOpenDialog(window, {
        title: "选择备份文件夹",
        defaultPath: library.backupDir,
        properties: ["openDirectory", "createDirectory"],
      });
      if (chosen.canceled) return null;
      return preferences.changeBackupDir(chosen.filePaths[0], library);
    }
    case "folder-create":
      return library.addFolder(
        requireText(payload.name, 80),
        payload.parentId ? id(payload.parentId) : null,
      );
    case "folder-rename":
      library.renameFolder(id(payload.id), requireText(payload.name, 80));
      return true;
    case "folder-delete": {
      const folder = library.folder(id(payload.id));
      const answer = await dialog.showMessageBox(window, {
        type: "warning",
        message: "删除文件夹“" + folder.name + "”？",
        detail:
          "此文件夹及其子文件夹会被移除，其中的资料（含回收站资料）会移至上级；顶层文件夹的资料将移至未分类。资料和标签不会被删除。",
        buttons: ["取消", "删除文件夹并保留资料"],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return { deleted: false };
      return { deleted: true, parentId: library.deleteFolder(folder.id) };
    }
    case "item-move":
      return library.moveItem(
        id(payload.id),
        payload.folderId ? id(payload.folderId) : null,
      );
    case "save": {
      id(payload.id);
      requireText(payload.title, 500);
      requireText(payload.html, 10 * 1024 * 1024);
      return library.save(payload.id, payload);
    }
    case "draft-put": {
      id(payload.id);
      requireText(payload.title, 500);
      requireText(payload.html, 10 * 1024 * 1024);
      if (!Number.isFinite(payload.time) || !Number.isFinite(payload.revision))
        throw new Error("无效草稿");
      const folder = path.join(library.root, "drafts");
      fs.mkdirSync(folder, { recursive: true });
      atomicWrite(
        path.join(folder, payload.id + ".json"),
        JSON.stringify(payload),
      );
      return true;
    }
    case "draft-get": {
      const file = path.join(library.root, "drafts", id(payload.id) + ".json");
      return fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, "utf8"))
        : null;
    }
    case "draft-clear": {
      const file = path.join(library.root, "drafts", id(payload.id) + ".json");
      if (fs.existsSync(file)) {
        const stored = JSON.parse(fs.readFileSync(file, "utf8"));
        if (
          stored.revision === payload.revision &&
          stored.time === payload.time
        )
          fs.unlinkSync(file);
      }
      return true;
    }
    case "open":
      library.open(id(payload.id));
      return true;
    case "favorite":
      library.favorite(id(payload.id));
      return true;
    case "trash":
      library.trash(id(payload.id), Boolean(payload.restore));
      return true;
    case "purge": {
      const ids = payload.all
        ? library.list({ view: "trash", limit: 200 }).items.map((i) => i.id)
        : [id(payload.id)];
      const choice = await dialog.showMessageBox(window, {
        type: "warning",
        title: "永久删除",
        message: payload.all ? "永久清空回收站？" : "永久删除这条资料？",
        detail: "删除后无法从回收站恢复。已创建的备份仍会保留。",
        buttons: ["取消", "永久删除"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response !== 1) return false;
      if (payload.all) {
        while (true) {
          const batch = library
            .list({ view: "trash", limit: 200 })
            .items.map((i) => i.id);
          if (!batch.length) break;
          library.purge(batch);
        }
      } else library.purge(ids);
      return true;
    }
    case "tag-add":
      return library.addTag(requireText(payload.name, 50));
    case "tag-rename":
      library.renameTag(id(payload.id), requireText(payload.name, 50));
      return true;
    case "tag-delete": {
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        message: "删除这个标签？",
        detail: "只移除标签及其关联，所有资料都会保留。",
        buttons: ["取消", "删除标签"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response !== 1) return false;
      library.deleteTag(id(payload.id));
      return true;
    }
    case "tag-merge":
      library.mergeTag(id(payload.source), id(payload.target));
      return true;
    case "set-tags":
      if (!Array.isArray(payload.tags) || payload.tags.length > 200)
        throw new Error("无效标签列表");
      library.setTags(id(payload.id), payload.tags.map(id));
      return true;
    case "import": {
      const result = await dialog.showOpenDialog(window, {
        title: "导入资料",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "知识资料",
            extensions: [
              "pdf",
              "epub",
              "doc",
              "docx",
              "md",
              "markdown",
              "png",
              "jpg",
              "jpeg",
              "gif",
              "webp",
            ],
          },
        ],
      });
      return result.canceled
        ? []
        : importPaths(result.filePaths, payload.folderId || null);
    }
    case "import-dropped":
      return importPaths(payload.paths, payload.folderId || null);
    case "image-add": {
      const result = await dialog.showOpenDialog(window, {
        title: "插入图片",
        filters: [
          { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });
      return result.canceled
        ? null
        : "kbasset://asset/" + library.copyAsset(result.filePaths[0]);
    }
    case "asset-bytes":
      return new Uint8Array(
        await fs.promises.readFile(library.assetPath(payload.asset)),
      );
    case "backup": {
      const result = await dialog.showSaveDialog(window, {
        title: "完整备份",
        defaultPath: path.join(
          library.backupDir,
          "拾知备份-" + localDay() + ".szkb",
        ),
        filters: [{ name: "拾知备份", extensions: ["szkb"] }],
      });
      return result.canceled ? null : library.backup(result.filePath);
    }
    case "restore": {
      if (teacher.busy.size) throw Error("请先等待或取消老师请求，再恢复备份");
      const result = await dialog.showOpenDialog(window, {
        title: "恢复完整备份",
        filters: [{ name: "拾知备份", extensions: ["szkb"] }],
      });
      if (result.canceled) return null;
      const confirm = await dialog.showMessageBox(window, {
        type: "warning",
        message: "用备份替换当前知识库？",
        detail: "将先校验备份并备份当前数据。恢复失败时保留现有知识库。",
        buttons: ["取消", "恢复备份"],
        defaultId: 0,
        cancelId: 0,
      });
      if (confirm.response !== 1) return null;
      generation++;
      const restored = library.restore(result.filePaths[0]);
      services();
      void indexPdfs();
      return restored;
    }
    case "export": {
      const item = library.get(id(payload.id));
      const result = await dialog.showSaveDialog(window, {
        title: "导出 Markdown 与图片",
        defaultPath: item.title.replace(/[<>:"/\\|?*]/g, "_") + ".zip",
        filters: [{ name: "笔记资源包", extensions: ["zip"] }],
      });
      return result.canceled
        ? null
        : library.exportNote(item.id, result.filePath);
    }
    case "reveal":
      return shell.openPath(
        payload.backups
          ? library.backupDir
          : payload.assets
            ? path.join(library.root, "assets")
            : library.root,
      );
    case "external": {
      const url = new URL(requireText(payload.url, 10000));
      if (!["https:", "http:", "mailto:"].includes(url.protocol))
        throw new Error("不支持的链接");
      return shell.openExternal(url.href);
    }
    case "close-ready":
      if (habitat.active) habitat.focusControl("pause");
      allowClose = true;
      window.close();
      return true;
    default:
      throw new Error("不支持的操作");
  }
});

if (relayMode)
  app.whenReady().then(() => {
    const port = Number(
      process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] || 47831,
    );
    const relay = createRelay({ port });
    relay.on("listening", () =>
      console.log("拾知自习服务已启动，端口 " + port),
    );
    relay.on("error", (e) => {
      console.error(e.message);
      app.quit();
    });
  });
if (hasLock && !relayMode)
  app.whenReady().then(async () => {
    const root = rootArg
      ? rootArg.slice("--library=".length)
      : path.join(app.getPath("userData"), "library");
    try {
      preferences = new Preferences(root);
      library = new Library(root, { backupDir: preferences.value.backupDir });
      if (preferences.warning) library.warning = preferences.warning;
      try {
        library.autoBackup();
      } catch (error) {
        library.warning = "自动备份失败：" + error.message;
      }
    } catch (error) {
      dialog.showErrorBox("无法打开知识库", error.message);
      app.quit();
      return;
    }
    services();
    worldTimer = setInterval(() => {
      try {
        habitat.tick();
        social.publish();
        if (library.warning.startsWith("专注保存失败：")) library.warning = "";
      } catch (e) {
        library.warning = "专注保存失败：" + e.message;
      }
    }, 2000);
    protocol.handle("kbasset", async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== "asset") throw new Error("资源不存在");
        const response = await net.fetch(
          pathToFileURL(library.assetPath(url.pathname.slice(1))).href,
        );
        return new Response(response.body, {
          status: 200,
          headers: {
            "Content-Type":
              response.headers.get("content-type") ||
              "application/octet-stream",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 1000,
      minHeight: 680,
      icon: path.join(here, "../dist/icon.png"),
      show: !process.argv.includes("--smoke-test"),
      backgroundColor: "#edf0e4",
      title: "拾知 · 林间学园",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(here, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== window.webContents.getURL()) event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    window.webContents.on("render-process-gone", (_event, details) => {
      dialog.showErrorBox(
        "界面异常退出",
        "已保存数据保留在本地。重启后可检查编辑草稿。\n" + details.reason,
      );
      allowClose = true;
      window.close();
    });
    window.on("close", (event) => {
      if (!allowClose) {
        event.preventDefault();
        window.webContents.send("prepare-close");
      }
    });
    if (devURL) await window.loadURL(devURL);
    else await window.loadFile(uiFile);
    void indexPdfs();
  });
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
app.on("window-all-closed", () => {
  if (relayMode) return;
  clearInterval(worldTimer);
  try {
    if (habitat?.getState("focus")) habitat.focusControl("pause");
  } catch (e) {
    console.error("专注记录保存失败", e.message);
  }
  social?.close();
  for (const c of teacher?.controllers?.values() || []) c.abort();
  library?.close();
  app.quit();
});
