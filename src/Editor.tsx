import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Link,
  ImagePlus,
  Table2,
  Undo2,
  Redo2,
  Code2,
  Minus,
} from "lucide-react";
type Props = {
  html: string;
  readOnly: boolean;
  onChange: (html: string, json: unknown) => void;
  onError: (message: string) => void;
  onLink: (apply: (url: string) => void, current: string) => void;
};
export default function Editor({
  html,
  readOnly,
  onChange,
  onError,
  onLink,
}: Props) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
        Image,
        TableKit.configure({ table: { resizable: true } }),
        Placeholder.configure({
          placeholder: "从一个想法开始，慢慢积累你的知识…",
        }),
      ],
      content: html || "<p></p>",
      editable: !readOnly,
      shouldRerenderOnTransaction: true,
      onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getJSON()),
      editorProps: {
        attributes: { "aria-label": "笔记正文", spellcheck: "false" },
      },
    },
    [readOnly],
  );
  if (!editor) return null;
  const button = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    active = false,
    disabled = false,
  ) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      className={active ? "tool active" : "tool"}
      disabled={disabled}
      onClick={action}
    >
      {icon}
    </button>
  );
  return (
    <div className="editor-wrap">
      {!readOnly && (
        <div className="editor-toolbar" aria-label="格式工具栏">
          <select
            aria-label="段落样式"
            value={
              editor.isActive("heading", { level: 1 })
                ? "1"
                : editor.isActive("heading", { level: 2 })
                  ? "2"
                  : editor.isActive("heading", { level: 3 })
                    ? "3"
                    : "0"
            }
            onChange={(e) => {
              const level = Number(e.target.value);
              if (level)
                editor
                  .chain()
                  .focus()
                  .setHeading({ level: level as 1 | 2 | 3 })
                  .run();
              else editor.chain().focus().setParagraph().run();
            }}
          >
            <option value="0">正文</option>
            <option value="1">大标题</option>
            <option value="2">标题</option>
            <option value="3">小标题</option>
          </select>
          <span className="tool-divider" />
          {button(
            "加粗",
            <Bold size={16} />,
            () => {
              editor.chain().focus().toggleBold().run();
            },
            editor.isActive("bold"),
          )}
          {button(
            "斜体",
            <Italic size={16} />,
            () => {
              editor.chain().focus().toggleItalic().run();
            },
            editor.isActive("italic"),
          )}
          {button(
            "删除线",
            <Strikethrough size={16} />,
            () => {
              editor.chain().focus().toggleStrike().run();
            },
            editor.isActive("strike"),
          )}
          <span className="tool-divider" />
          {button(
            "无序列表",
            <List size={17} />,
            () => {
              editor.chain().focus().toggleBulletList().run();
            },
            editor.isActive("bulletList"),
          )}
          {button(
            "有序列表",
            <ListOrdered size={17} />,
            () => {
              editor.chain().focus().toggleOrderedList().run();
            },
            editor.isActive("orderedList"),
          )}
          {button(
            "引用",
            <Quote size={16} />,
            () => {
              editor.chain().focus().toggleBlockquote().run();
            },
            editor.isActive("blockquote"),
          )}
          {button(
            "代码块",
            <Code2 size={17} />,
            () => {
              editor.chain().focus().toggleCodeBlock().run();
            },
            editor.isActive("codeBlock"),
          )}
          <span className="tool-divider" />
          {button(
            "添加链接",
            <Link size={16} />,
            () =>
              onLink(
                (url) => {
                  if (!url) editor.chain().focus().unsetLink().run();
                  else if (/^(https?:\/\/|mailto:)/i.test(url))
                    editor.chain().focus().setLink({ href: url }).run();
                  else onError("请输入 http、https 或 mailto 链接");
                },
                String(editor.getAttributes("link").href || ""),
              ),
            editor.isActive("link"),
          )}
          {button("插入图片", <ImagePlus size={17} />, () => {
            window.knowledge
              .call<string | null>("image-add")
              .then((src) => {
                if (src) editor.chain().focus().setImage({ src }).run();
              })
              .catch((e) => onError(e.message));
          })}
          {button("插入表格", <Table2 size={17} />, () => {
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run();
          })}
          {button("分隔线", <Minus size={17} />, () => {
            editor.chain().focus().setHorizontalRule().run();
          })}
          <span className="tool-divider" />
          {button(
            "撤销",
            <Undo2 size={16} />,
            () => {
              editor.chain().focus().undo().run();
            },
            false,
            !editor.can().undo(),
          )}
          {button(
            "重做",
            <Redo2 size={16} />,
            () => {
              editor.chain().focus().redo().run();
            },
            false,
            !editor.can().redo(),
          )}
          {editor.isActive("table") && (
            <>
              <button
                className="text-tool"
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                加行
              </button>
              <button
                className="text-tool"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                加列
              </button>
              <button
                className="text-tool"
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                删表
              </button>
            </>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
