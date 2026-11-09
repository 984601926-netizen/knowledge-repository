import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "./store.mjs";

export const defaults = {
  theme: "light",
  editorFontSize: 14,
  autosaveDelay: 1000,
};
function canonical(filename) {
  const absolute = path.resolve(filename);
  if (fs.existsSync(absolute)) return fs.realpathSync.native(absolute);
  const parent = path.dirname(absolute);
  if (parent === absolute) return absolute;
  return path.join(canonical(parent), path.basename(absolute));
}
export class Preferences {
  constructor(root) {
    this.root = path.resolve(root);
    this.file = this.root + "-settings.json";
    this.value = { ...defaults, backupDir: this.root + "-backups" };
    this.warning = "";
    if (fs.existsSync(this.file)) {
      try {
        this.value = this.validate({
          ...this.value,
          ...JSON.parse(fs.readFileSync(this.file, "utf8")),
        });
      } catch (error) {
        this.warning =
          "设置文件无法读取，已使用默认设置；原文件保留。" + error.message;
      }
    }
  }
  validate(value) {
    if (
      !["light", "dark", "system"].includes(value.theme) ||
      ![12, 14, 16, 18, 20, 22].includes(value.editorFontSize) ||
      ![500, 1000, 2000, 5000].includes(value.autosaveDelay)
    )
      throw new Error("无效的外观或编辑设置");
    if (
      typeof value.backupDir !== "string" ||
      !path.isAbsolute(value.backupDir)
    )
      throw new Error("备份位置必须为绝对目录");
    const backup = canonical(value.backupDir).toLowerCase(),
      root = canonical(this.root).toLowerCase();
    if (backup === root || backup.startsWith(root + path.sep))
      throw new Error("备份位置不能位于知识库数据目录内，请选择独立目录");
    return {
      theme: value.theme,
      editorFontSize: value.editorFontSize,
      autosaveDelay: value.autosaveDelay,
      backupDir: path.resolve(value.backupDir),
    };
  }
  update(patch) {
    if (Object.keys(patch).some((key) => !Object.hasOwn(defaults, key)))
      throw new Error("不支持的设置项");
    return this.persist(this.validate({ ...this.value, ...patch }));
  }
  persist(value) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    atomicWrite(this.file, JSON.stringify(value, null, 2));
    this.value = value;
    return { ...this.value };
  }
  changeBackupDir(directory, library) {
    const next = this.validate({ ...this.value, backupDir: directory });
    // A complete backup proves both writability and capacity before switching settings.
    const backup = library.backup(
      path.join(
        next.backupDir,
        "after-location-change-" + Date.now() + ".szkb",
      ),
    );
    this.persist(next);
    library.backupDir = next.backupDir;
    return { preferences: { ...this.value }, backup };
  }
}
