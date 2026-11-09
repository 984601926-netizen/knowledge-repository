# 拾知 · 个人知识库 V1

面向个人的 Windows 离线知识库：可视化笔记、PDF 阅读、图片资料、标签整理和中文搜索。无需账号，运行时不依赖云端服务。

## 使用

安装 `release/Shizhi-Setup-1.0.0.exe`，或直接运行 `release/win-unpacked/拾知.exe`（整个目录必须保留）。

- **新建笔记**：左侧按钮或 `Ctrl+N`。支持标题、加粗、斜体、列表、引用、代码块、链接、表格及本地图片。
- **导入资料**：点击资料列表右上角的导入按钮，或将文件拖进窗口。支持 PDF、Markdown、PNG、JPG、GIF、WebP；导入文件复制到知识库。单文件上限 200 MB，Markdown 上限 10 MB，一次最多 500 个文件。
- **搜索**：`Ctrl+K` 聚焦搜索框。搜索标题、正文、备注、标签和已索引的 PDF 原文；多选标签采用 AND 规则。支持类型、收藏和时间排序筛选。
- **阅读**：PDF 支持页码跳转及缩放，正文搜索结果可跳转到命中页；扫描 PDF 不做 OCR。PDF 和图片拥有独立的可编辑备注。
- **标签**：在资料标题下添加；侧栏的“管理标签”提供改名、合并和删除，删除标签不会删除资料。
- **删除**：先进入回收站；恢复后可以继续编辑。永久删除和清空回收站会显示确认框。
- **导出**：笔记右上角下载按钮导出 ZIP，内含 `note.md`、图片目录及标签元数据；完整迁移请使用完整备份。
- **阅读空间**：拖动两条分隔线调整宽度，内容区左上角按钮展开阅读。

## 保存和恢复

输入停止约 1 秒后自动保存，也可按 `Ctrl+S`。保存失败时会显示重试入口，并阻止切换资料和正常关闭窗口。编辑草稿经主进程独立落盘；异常退出后，打开对应资料可选择恢复草稿。主进程尚未收到的最后一次输入不能保证恢复。

默认知识库位于 `%APPDATA%/zhishi-local/library`，准确位置以应用“设置与备份”显示为准。一个目录管理一个知识库：

```text
library/
  library.sqlite           # SQLite 主数据库
  library.sqlite.previous  # 前一次完整保存
  assets/                  # 复制后的原始资料、笔记图片
  drafts/                  # 未保存的编辑草稿
library-backups/
  auto-YYYY-MM-DD.szkb      # 每天首次打开备份，保留最近 7 份
  before-restore-*.szkb     # 恢复前的安全备份，不参与自动轮换
```

数据库采用事务处理及临时文件写入、同步、原子替换；写入失败回滚内存状态。主数据库损坏时尝试校验并恢复 `.previous`，同时保留损坏原件并提示。数据目录切换使用恢复日志，进程中断后启动时可找回原库。这些措施不能替代独立磁盘备份，也不提供完整编辑历史。

“设置与备份”提供手动备份、恢复及打开目录。`.szkb` 是包含 SQLite、附件和 SHA-256 清单的 ZIP，恢复时检查路径、清单、文件哈希、数据库与附件引用；通过后先备份当前库，再切换目录。恢复前的目录作为 `.rollback-*` 额外保留，供手动检查。备份包含已保存资料及回收站，不包含未保存草稿。完整备份当前限制 512 MB。

可使用命令行参数指定其他本地知识库目录，首次运行自动创建：

```powershell
& '.\release\win-unpacked\拾知.exe' '--library=D:\我的知识库'
```

首版不提供后台附件清理：永久删除资料条目后，附件文件仍可能保留，以避免共享图片及前一份数据库恢复时丢失资源。暂不提供多设备同步、多人协作、加密、AI、OCR、PDF 批注或 Office 正文解析。

## 开发和验证

需要 Node.js 24 和 Windows 10/11 x64。依赖由 `package-lock.json` 锁定。

```powershell
npm ci
npm run dev       # Vite + Electron 开发窗口
npm run build     # TypeScript 检查与离线资源构建
npm start         # 打开已构建的桌面应用
npm test          # 存储、恢复、PDF、性能等测试
npm run test:ui   # 隐藏窗口中的桌面端到端验收
npm run dist      # 构建 Windows NSIS 安装包
```

UI 测试使用 `.test-data/` 独立数据目录，不写入正式知识库。截图位于 `test-results/`。可通过 `SHIZHI_EXECUTABLE` 环境变量将 UI 测试指向打包后的程序。

运行时使用 SQLite（sql.js，主进程单写者）、React、Tiptap 和 PDF.js。Electron 通过限定的 preload 接口通信，启用上下文隔离及渲染沙箱，禁止渲染器直接访问 Node 和任意导航；导入 HTML 做白名单清理，外部链接仅允许 HTTP、HTTPS 和 mailto。实现遵循 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)；编辑器扩展见 [Tiptap 文档](https://tiptap.dev/docs/editor/extensions/functionality/starterkit)，PDF 解析和渲染见 [PDF.js 示例](https://mozilla.github.io/pdf.js/examples/)。

构建工具首次使用需要下载 Electron 和 NSIS；安装后使用应用不需要网络。此构建未配置商业代码签名证书。
