import { _electron as electron, expect } from "playwright/test";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".test-data/upgrade-" + Date.now());
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync("test-results", { recursive: true });
const markdown = path.join(root, "待分类资料.md");
fs.writeFileSync(markdown, "# 研究素材\n\n分类与设置验收");
let app, page;
const errors = [];
const call = (action, payload) =>
  page.evaluate(
    ({ action, payload }) => window.knowledge.call(action, payload),
    { action, payload },
  );
const launch = async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: process.env.SHIZHI_EXECUTABLE || electronPath,
    args: [
      ...(process.env.SHIZHI_EXECUTABLE ? [] : ["."]),
      "--smoke-test",
      "--library=" + path.join(root, "library"),
      "--profile=" + path.join(root, "profile"),
    ],
    env,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".new-note").waitFor();
};
const screenshot = async (name) => {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.waitForTimeout(150);
  const image = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      })
    )
      .toPNG()
      .toString("base64"),
  );
  fs.writeFileSync(
    path.resolve("test-results", name + ".png"),
    Buffer.from(image, "base64"),
  );
};
const confirmName = async (name) => {
  await page.locator('input[name="value"]').fill(name);
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
};
const category = (name) =>
  page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name, exact: true });
try {
  await launch();
  await page
    .locator(".item-list")
    .click({ button: "right", position: { x: 20, y: 20 } });
  await page.getByRole("menuitem", { name: "新建文件夹", exact: true }).click();
  await confirmName("项目研究");
  const parent = (await call("list")).folders.find(
    (folder) => folder.name === "项目研究",
  );
  await page.locator(".folder-card").filter({ hasText: "项目研究" }).click();
  await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
  await confirmName("文献资料");
  const child = (await call("list")).folders.find(
    (folder) => folder.name === "文献资料",
  );
  await page
    .locator(".folder-card")
    .filter({ hasText: "文献资料" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "重命名文件夹", exact: true })
    .click();
  await confirmName("参考文献");
  await page.locator(".folder-card").filter({ hasText: "参考文献" }).click();
  await page.locator(".new-note").click();
  await page.getByRole("textbox", { name: "资料标题" }).fill("架构方案");
  await page.locator(".tiptap").fill("项目中的关键设计决策。");
  await expect(page.locator(".save-status")).toHaveText("已保存");
  const note = (await call("list", { folderId: child.id })).items[0];
  if (note.folder_id !== child.id) throw new Error("新建笔记未归入当前文件夹");
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filename],
    });
  }, markdown);
  await page
    .getByRole("button", { name: "导入资料", exact: true })
    .first()
    .click();
  await expect(page.locator(".item-card")).toHaveCount(2);
  if ((await call("list", { folderId: child.id })).total !== 2)
    throw new Error("导入未归入当前文件夹");
  await page
    .locator(".item-card")
    .filter({ hasText: "架构方案" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "移动到文件夹", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "目标文件夹" })
    .selectOption(parent.id);
  await page.getByRole("button", { name: "移动", exact: true }).click();
  await expect(page.locator(".item-card")).toHaveCount(1);
  if ((await call("get", { id: note.id })).folder_id !== parent.id)
    throw new Error("资料移动失败");
  await page
    .getByRole("button", { name: "返回上级文件夹", exact: true })
    .click();
  await expect(page.locator(".item-card")).toHaveCount(1);
  await expect(page.locator(".folder-card")).toHaveCount(1);
  await screenshot("folders-v1.1");
  await page
    .locator(".folder-card")
    .filter({ hasText: "参考文献" })
    .click({ button: "right" });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 0,
      checkboxChecked: false,
    });
  });
  await page
    .getByRole("menuitem", { name: "删除文件夹并保留资料", exact: true })
    .click();
  await expect(page.locator(".folder-card")).toHaveCount(1);
  await page
    .locator(".folder-card")
    .filter({ hasText: "参考文献" })
    .click({ button: "right" });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await page
    .getByRole("menuitem", { name: "删除文件夹并保留资料", exact: true })
    .click();
  await expect(page.locator(".item-card")).toHaveCount(2);
  await expect(page.locator(".folder-card")).toHaveCount(0);
  await page.getByRole("button", { name: "设置与备份", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "设置分类" }).getByRole("button"),
  ).toHaveCount(6);
  await category("备份与恢复").click();
  const oldLocation = (await call("info")).backupDir,
    chosen = path.join(root, "自定义备份");
  fs.mkdirSync(chosen);
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, chosen);
  await page.getByRole("button", { name: "更改备份位置", exact: true }).click();
  await expect(page.getByTestId("backup-location")).toHaveText(chosen);
  if (
    !fs
      .readdirSync(chosen)
      .some((name) => name.startsWith("after-location-change-")) ||
    !fs.existsSync(oldLocation)
  )
    throw new Error("新备份或旧备份未保留");
  await screenshot("settings-backup-v1.1");
  await category("外观与编辑").click();
  await page.getByRole("combobox", { name: "界面主题" }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("combobox", { name: "笔记正文字号" }).selectOption("18");
  await page
    .getByRole("combobox", { name: "自动保存间隔" })
    .selectOption("2000");
  await expect(
    page.getByRole("combobox", { name: "自动保存间隔" }),
  ).toHaveValue("2000");
  await screenshot("settings-appearance-v1.1");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 680),
  );
  await expect(
    page.getByRole("button", { name: "关闭设置", exact: true }),
  ).toBeVisible();
  await screenshot("settings-min-window-v1.1");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await app.close();
  await launch();
  const restarted = await call("info");
  if (
    restarted.backupDir !== chosen ||
    restarted.preferences.theme !== "dark" ||
    restarted.preferences.editorFontSize !== 18 ||
    restarted.preferences.autosaveDelay !== 2000
  )
    throw new Error("设置重启后未保持");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if (!(await call("list")).folders.some((folder) => folder.id === parent.id))
    throw new Error("文件夹重启丢失");
  if (!fs.readdirSync(chosen).some((name) => name.startsWith("auto-")))
    throw new Error("重启未使用新备份目录");
  if (errors.length) throw new Error(errors.join("\n"));
  await app.close();
  console.log(
    "V1.1 桌面验收通过：右键建文件夹、子目录、改名、新建及导入归属、资料移动、取消/确认删文件夹保留资料、设置分类、更改备份位置、外观编辑偏好及重启保持。",
  );
} catch (error) {
  await screenshot("upgrade-failure").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
}
