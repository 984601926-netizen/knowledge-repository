import { _electron as electron, expect } from "playwright/test";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";
import { PNG, writePdf } from "../tests/fixtures.mjs";

const root = path.resolve(".test-data/ui-" + Date.now());
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync("test-results", { recursive: true });
const pdfFile = path.join(root, "阅读资料.pdf"),
  imageFile = path.join(root, "灵感.png"),
  mdFile = path.join(root, "阅读笔记.md");
writePdf(pdfFile, [
  "First page of reading notes",
  "Searchable knowledge on page two",
]);
fs.writeFileSync(imageFile, PNG);
fs.writeFileSync(
  mdFile,
  "# 读书与思考\n\n把零散的灵感变成知识。\n\n- 定期回顾\n- 持续积累\n\n![灵感](灵感.png)",
);
let app, page;
const errors = [];
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
  await page.getByRole("button", { name: "新建笔记" }).waitFor();
};
const call = (action, payload) =>
  page.evaluate(
    ({ action, payload }) => window.knowledge.call(action, payload),
    { action, payload },
  );
const screenshot = async (name) => {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.waitForTimeout(150);
  const png = await app.evaluate(async ({ BrowserWindow }) =>
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
    Buffer.from(png, "base64"),
  );
};
try {
  await launch();
  await screenshot("welcome");
  await page.getByRole("button", { name: "新建笔记" }).click();
  await page
    .getByRole("textbox", { name: "资料标题" })
    .fill("设计一个自己的知识系统");
  await page
    .locator(".tiptap")
    .fill("知识管理不是简单的收藏，而是建立可持续的思考习惯。中文搜索验收。");
  await expect(page.locator(".save-status")).toHaveText("已保存", {
    timeout: 10000,
  });
  const note = (await call("list")).items[0];
  await page.getByRole("button", { name: "添加标签", exact: true }).click();
  await page.getByRole("button", { name: "创建新标签" }).click();
  await page.locator('input[name="value"]').fill("知识管理");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".document-tags")).toContainText("知识管理");
  await page.getByRole("button", { name: "关闭标签选择" }).click();
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  const reports = await call("import-dropped", {
    paths: [mdFile, pdfFile, imageFile, path.join(root, "不存在.pdf")],
  });
  if (
    reports.filter((r) => r.ok).length !== 3 ||
    reports.filter((r) => !r.ok).length !== 1
  )
    throw new Error("批量导入结果异常");
  await page.getByRole("textbox", { name: "搜索知识库" }).fill("中文搜索");
  await expect(page.locator(".item-card")).toHaveCount(1);
  await page.locator(".item-card").click();
  await expect(page.getByRole("textbox", { name: "资料标题" })).toHaveValue(
    "设计一个自己的知识系统",
  );
  await page.getByRole("button", { name: "清除搜索" }).click();
  await expect(page.locator(".item-card")).toHaveCount(4);
  await screenshot("library");
  // Real background extraction and renderer canvas, including search navigation to page 2.
  await expect
    .poll(
      async () => (await call("list", { query: "Searchable knowledge" })).total,
      { timeout: 20000 },
    )
    .toBe(1);
  await page
    .getByRole("textbox", { name: "搜索知识库" })
    .fill("Searchable knowledge");
  await expect(page.locator(".item-card")).toHaveCount(1);
  await page.locator(".item-card").click();
  await expect(page.getByRole("spinbutton", { name: "PDF 页码" })).toHaveValue(
    "2",
  );
  await expect
    .poll(
      () =>
        page.locator(".pdf-reader canvas").evaluate((canvas) => canvas.width),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".pdf-tools .spin")).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.locator(".inline-error")).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator(".pdf-reader canvas").evaluate((canvas) => {
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] < 180 && pixels[i + 3] > 0) return true;
        return false;
      }),
    )
    .toBe(true);
  await screenshot("pdf-reader");
  // Markdown import retains its copied local image after removal of the original file.
  fs.unlinkSync(imageFile);
  await page.getByRole("textbox", { name: "搜索知识库" }).fill("阅读笔记");
  await expect(page.locator(".item-card")).toHaveCount(1);
  await page.locator(".item-card").click();
  await expect
    .poll(() =>
      page
        .locator(".tiptap img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  // Draft recovery is exercised by exiting before the one-second save timer.
  await page.getByRole("textbox", { name: "搜索知识库" }).fill("");
  await expect(page.locator(".item-card")).toHaveCount(4);
  await page
    .locator(".item-card")
    .filter({ hasText: "设计一个自己的知识系统" })
    .click();
  await expect(page.getByRole("textbox", { name: "资料标题" })).toHaveValue(
    "设计一个自己的知识系统",
  );
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  // Replace the database file with a directory to cause an actual failed atomic rename.
  const databaseFile = path.join(root, "library", "library.sqlite");
  fs.renameSync(databaseFile, databaseFile + ".held");
  fs.mkdirSync(databaseFile);
  await page
    .getByRole("textbox", { name: "资料标题" })
    .fill("磁盘失败时保留的标题");
  await expect(page.locator(".save-status")).toContainText("保存失败", {
    timeout: 10000,
  });
  await page.locator(".item-card").filter({ hasText: "阅读笔记" }).click();
  await expect(page.getByRole("textbox", { name: "资料标题" })).toHaveValue(
    "磁盘失败时保留的标题",
  );
  fs.rmdirSync(databaseFile);
  fs.renameSync(databaseFile + ".held", databaseFile);
  await page.locator(".save-status").click();
  await expect(page.locator(".save-status")).toHaveText("已保存", {
    timeout: 10000,
  });
  await page
    .getByRole("textbox", { name: "资料标题" })
    .fill("设计一个自己的知识系统");
  await page.locator(".save-status").click();
  await expect(page.locator(".save-status")).toHaveText("已保存");
  await page
    .getByRole("textbox", { name: "资料标题" })
    .fill("异常退出前的草稿");
  await expect
    .poll(async () => (await call("draft-get", { id: note.id }))?.title, {
      timeout: 800,
    })
    .toBe("异常退出前的草稿");
  await app.evaluate(({ app }) => app.exit(0));
  await launch();
  await page
    .locator(".item-card")
    .filter({ hasText: "设计一个自己的知识系统" })
    .click();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "资料标题" })).toHaveValue(
    "异常退出前的草稿",
  );
  await expect(page.locator(".save-status")).toHaveText("已保存", {
    timeout: 10000,
  });
  // Exercise backup and restore through the real IPC routes; only native pickers are stubbed.
  const backupFile = path.join(root, "ui-backup.szkb");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, backupFile);
  await page.getByRole("button", { name: "设置与备份", exact: true }).click();
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "备份与恢复", exact: true })
    .click();
  await page.getByRole("button", { name: "创建完整备份", exact: true }).click();
  await expect.poll(() => fs.existsSync(backupFile)).toBe(true);
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const extra = await call("create");
  await call("trash", { id: extra.id });
  await call("purge", { id: extra.id });
  await page.getByRole("button", { name: "从备份恢复", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if ((await call("get", { id: note.id })).title !== "异常退出前的草稿")
    throw new Error("恢复后的笔记不一致");
  if ((await call("list")).total !== 4) throw new Error("恢复后的条目数不一致");
  if (errors.length) throw new Error("界面异常：" + errors.join("\n"));
  await app.close();
  console.log(
    "UI 验收通过：编辑、自动保存、标签、收藏、批量导入、中文搜索、PDF 索引与渲染及跳页、图片复制、写入失败阻止切换及重试、异常退出草稿恢复、完整备份与恢复。",
  );
  console.log("截图：" + path.resolve("test-results"));
} catch (error) {
  if (page && !page.isClosed()) await screenshot("failure").catch(() => {});
  console.error(error);
  console.error("page errors", errors);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
}
