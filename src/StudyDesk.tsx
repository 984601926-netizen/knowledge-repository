import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  MessageCircle,
  ListTree,
  NotebookPen,
  Send,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  LoaderCircle,
  X,
  LockKeyhole,
  Link as LinkIcon,
  Plus,
} from "lucide-react";
import PdfReader from "./PdfReader";
import type { Item } from "./types";
import type { WorldState, Session, Point, Chapter } from "./worldTypes";
import { world, stateLabel } from "./worldTypes";
function pointOutline(points: Point[]) {
  const children = new Map<string | null, Point[]>(),
    byId = new Map(points.map((p) => [p.id, p])),
    seen = new Set<string>(),
    result: (Point & { depth: number })[] = [];
  for (const p of points) {
    const parent = p.parent_id && byId.has(p.parent_id) ? p.parent_id : null;
    children.set(parent, [...(children.get(parent) || []), p]);
  }
  const walk = (parent: string | null, depth: number) => {
    if (depth > 20) return;
    for (const p of children.get(parent) || []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      result.push({ ...p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const p of points) if (!seen.has(p.id)) result.push({ ...p, depth: 0 });
  return result;
}

export function PointEditor({
  point,
  onDone,
  notify,
}: {
  point: Point;
  onDone: () => void;
  notify: (s: string) => void;
}) {
  const [title, setTitle] = useState(point.title),
    [question, setQuestion] = useState(point.question),
    [answer, setAnswer] = useState(point.answer),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="point-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await world("point-confirm", {
            id: point.id,
            title,
            question,
            answer,
          });
          onDone();
        } catch (e: any) {
          notify(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        知识点标题
        <input
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        复习时呈现的问题
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <label>
        参考要点
        <textarea
          required
          rows={8}
          maxLength={12000}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </label>
      <p className="muted">
        {point.source_title || "自由学习"} · {point.chapter}
        {point.effective_private ? " · 私密" : ""}
      </p>
      <div className="button-row">
        {point.state === "draft" && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (await world("point-discard", { id: point.id })) onDone();
              } catch (e: any) {
                notify(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            丢弃草稿
          </button>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? "保存中…"
            : point.state === "draft"
              ? "确认加入知识库"
              : "保存修改"}
        </button>
      </div>
    </form>
  );
}

export default function StudyDesk({
  state,
  initialSessionId,
  initialPoint,
  onLibrary,
  onReward,
  refresh,
  notify,
}: {
  state: WorldState;
  initialSessionId: string | null;
  initialPoint: Point | null;
  onLibrary: () => void;
  onReward: (r: any) => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [session, setSession] = useState<Session | null>(null),
    [item, setItem] = useState<Item | null>(null),
    [chapters, setChapters] = useState<Chapter[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(1),
    [pane, setPane] = useState("teacher"),
    [outline, setOutline] = useState(true),
    [input, setInput] = useState(""),
    [topic, setTopic] = useState(""),
    [selectedPoint, setSelectedPoint] = useState<Point | null>(initialPoint),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Point | null>(null),
    [loading, setLoading] = useState(false);
  const request = useRef(""),
    scroll = useRef<HTMLDivElement>(null),
    sequence = useRef(0),
    sessionRef = useRef(session);
  sessionRef.current = session;
  const load = async (id: string) => {
    const seq = ++sequence.current;
    setLoading(true);
    try {
      const s = await world<Session>("session", { id });
      const source = s.source_id
        ? await window.knowledge.call<Item>("get", { id: s.source_id })
        : null;
      const cs =
        source && !source.deleted_at && source.kind !== "word"
          ? await world<Chapter[]>("chapters", { id: source.id })
          : [];
      if (seq !== sequence.current) return;
      setSession(s);
      setItem(source);
      setChapters(cs);
      const progress = state.progress.find((p) => p.source_id === source?.id);
      setPage(
        initialPoint?.source_id === source?.id
          ? initialPoint?.locator || 1
          : progress?.page || 1,
      );
      setTotal(progress?.total || cs.length || 1);
      setInput(localStorage.getItem("teacher-draft:" + s.id) || "");
    } catch (e: any) {
      notify(e.message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (initialSessionId) void load(initialSessionId);
  }, [initialSessionId]);
  useEffect(() => {
    setSelectedPoint(initialPoint);
    if (initialPoint) {
      setPane("teacher");
      setPage(initialPoint.locator);
    }
  }, [initialPoint?.id, initialSessionId]);
  useEffect(() => {
    if (session) localStorage.setItem("teacher-draft:" + session.id, input);
  }, [input, session?.id]);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [session?.messages.length]);
  useEffect(() => {
    if (!item || item.kind === "word") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void world("reading-pulse", { id: item.id })
          .then((seed) => {
            if (seed) {
              onReward({ seed, label: "阅读中的意外发现" });
              void refresh();
            }
          })
          .catch((e) => notify(e.message));
    }, 30000);
    return () => clearInterval(timer);
  }, [item?.id]);
  useEffect(
    () => () => {
      if (request.current)
        void world("teacher-cancel", { requestId: request.current });
    },
    [],
  );
  const start = async () => {
    if (!topic.trim()) return;
    try {
      const s = await world<Session>("session", { topic: topic.trim() });
      setSelectedPoint(null);
      await load(s.id);
      await refresh();
    } catch (e: any) {
      notify(e.message);
    }
  };
  const record = (p: number, n: number) => {
    setPage(p);
    setTotal(n);
    if (item)
      void world("progress", {
        sourceId: item.id,
        page: p,
        total: n,
        chapter: chapters.find((c) => c.page === p)?.title || "第 " + p + " 页",
      }).catch((e) => notify(e.message));
  };
  const points = state.points.filter(
    (p) =>
      p.source_id === (item?.id || null) &&
      (item || p.chapter === session?.topic),
  );
  const outlinePoints = pointOutline(points);
  const chapter = chapters.find((c) => c.page === page);
  const send = async (action: "chat" | "extract" | "assess") => {
    if (!session || busy) return;
    if (action === "assess" && !selectedPoint) {
      notify("请先从大纲或复习中心选择一个知识点");
      return;
    }
    setBusy(true);
    request.current = crypto.randomUUID();
    try {
      const result = await world(action, {
        sessionId: session.id,
        pointId: selectedPoint?.id,
        page,
        chapter: chapter?.title || session.topic,
        message: input,
        requestId: request.current,
      });
      setSession(result.session);
      if (action !== "extract") setInput("");
      if (result.reward) onReward(result.reward);
      if (action === "extract") notify("梳理完成，请在知识点记录中审阅");
      await refresh();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
      request.current = "";
    }
  };
  return (
    <section className="study-desk">
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">THE STUDY</span>
          <h1>{item?.title || session?.topic || "在这里，慢慢想明白。"}</h1>
        </div>
        <div className="heading-actions">
          <button onClick={onLibrary}>
            <BookOpen size={16} />
            从书架选书
          </button>
          <button
            className={outline ? "selected" : ""}
            onClick={() => setOutline((v) => !v)}
          >
            <ListTree size={16} />
            大纲
          </button>
          <button
            className={pane === "points" ? "selected" : ""}
            onClick={() => setPane((p) => (p === "points" ? "" : "points"))}
          >
            <NotebookPen size={16} />
            知识点
          </button>
          <button
            className={pane === "teacher" ? "selected" : ""}
            onClick={() => setPane((p) => (p === "teacher" ? "" : "teacher"))}
          >
            <MessageCircle size={16} />
            老师
          </button>
        </div>
      </header>
      <div
        className={
          "study-layout " +
          (!outline ? "no-outline" : "") +
          (!pane ? " no-pane" : "")
        }
      >
        {outline && (
          <aside className="study-outline">
            <h3>学习路径</h3>
            <button
              className="text-button"
              onClick={() => {
                setSession(null);
                setItem(null);
                setChapters([]);
                setSelectedPoint(null);
              }}
            >
              ＋ 自由主题学习
            </button>
            <div className="small-label">章节与知识点</div>
            {chapters
              .filter(
                (c) => (c as Chapter & { heading?: boolean }).heading !== false,
              )
              .map((c) => (
                <div key={c.page}>
                  <button
                    className={
                      "chapter-link " + (page === c.page ? "active" : "")
                    }
                    onClick={() => record(c.page, chapters.length)}
                  >
                    {c.title}
                  </button>
                  {outlinePoints
                    .filter(
                      (p) => p.chapter === c.title || p.locator === c.page,
                    )
                    .map((p) => (
                      <button
                        className="outline-point"
                        key={p.id}
                        style={{ paddingLeft: 12 + p.depth * 12 }}
                        onClick={() => {
                          setSelectedPoint(p);
                          setPage(p.locator);
                          setPane("teacher");
                        }}
                      >
                        <span className={"point-dot " + p.state} />
                        {p.title}
                      </button>
                    ))}
                </div>
              ))}
            {!item &&
              outlinePoints.map((p) => (
                <button
                  className="outline-point"
                  key={p.id}
                  style={{ paddingLeft: 12 + p.depth * 12 }}
                  onClick={() => {
                    setSelectedPoint(p);
                    setPane("teacher");
                  }}
                >
                  <span className={"point-dot " + p.state} />
                  {p.title}
                </button>
              ))}
            <div className="small-label">保留的学习对话</div>
            {state.sessions.map((s) => (
              <button
                key={s.id}
                className={
                  "session-link " + (session?.id === s.id ? "active" : "")
                }
                disabled={busy}
                onClick={() => {
                  setSelectedPoint(null);
                  void load(s.id);
                }}
              >
                <MessageCircle size={13} />
                {s.topic}
              </button>
            ))}
          </aside>
        )}
        <main className="reading-main">
          {loading ? (
            <div className="world-empty">
              <LoaderCircle className="spin" />
              正在打开学习记录…
            </div>
          ) : !session ? (
            <div className="study-welcome">
              <span className="book-medallion">
                <BookOpen size={34} />
              </span>
              <span className="eyebrow">FOLLOW YOUR CURIOSITY</span>
              <h2>今天，想弄懂什么？</h2>
              <p>从书架选一本书，或带着一个问题，与老师开始新的讨论。</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void start();
                }}
              >
                <input
                  aria-label="自由学习主题"
                  value={topic}
                  maxLength={200}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="例如：理解 Agent 的工具调用"
                />
                <button className="primary" disabled={!topic.trim()}>
                  开始学习
                </button>
              </form>
            </div>
          ) : item?.kind === "pdf" ? (
            <PdfReader asset={item.asset!} hitPage={page} onPage={record} />
          ) : item ? (
            <>
              <div className="chapter-toolbar">
                <button
                  title="上一章"
                  disabled={page <= 1}
                  onClick={() => record(page - 1, chapters.length)}
                >
                  <ChevronLeft size={17} />
                </button>
                <select
                  aria-label="阅读章节"
                  value={page}
                  onChange={(e) =>
                    record(Number(e.target.value), chapters.length)
                  }
                >
                  {chapters.map((c) => (
                    <option value={c.page} key={c.page}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <span>
                  {page} / {Math.max(1, chapters.length)}
                </span>
                <button
                  title="下一章"
                  disabled={page >= chapters.length}
                  onClick={() => record(page + 1, chapters.length)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              <article
                className="epub-page"
                dangerouslySetInnerHTML={{
                  __html: chapter?.html || "<p>资料暂无可阅读内容。</p>",
                }}
              />
            </>
          ) : (
            <div className="topic-page">
              <span className="eyebrow">A QUESTION WORTH EXPLORING</span>
              <h2>{session.topic}</h2>
              <p>先说说你的理解，让老师帮你找到下一步。</p>
              {selectedPoint && (
                <div className="review-question">
                  <small>请用自己的话讲解</small>
                  <h3>{selectedPoint.question}</h3>
                  <p>准确讲解即可掌握，分数只是帮助你观察进步。</p>
                  <details>
                    <summary>需要提示时，查看参考要点</summary>
                    <p>{selectedPoint.answer}</p>
                  </details>
                </div>
              )}
              <div className="topic-notes">
                {points
                  .filter((p) => p.state !== "draft")
                  .map((p) => (
                    <section key={p.id}>
                      <small>{stateLabel[p.state]}</small>
                      <h3>{p.title}</h3>
                      <p>{p.question}</p>
                    </section>
                  ))}
              </div>
            </div>
          )}
          {session && (
            <footer className="reading-footer">
              <span>
                {item
                  ? "阅读进度 " +
                    Math.round((page / Math.max(total, 1)) * 100) +
                    "%"
                  : "自由主题学习"}{" "}
                · 对话已保存
              </span>
              <span>
                {points.filter((p) => p.state === "mastered").length} /{" "}
                {points.filter((p) => p.state !== "draft").length}{" "}
                个知识点已掌握{item?.private ? " · 私密资料" : ""}
              </span>
            </footer>
          )}
        </main>
        {pane && (
          <aside className="teacher-panel">
            <header>
              <div>
                <span className="eyebrow">
                  {pane === "teacher"
                    ? "YOUR PATIENT GUIDE"
                    : "KNOWLEDGE JOURNAL"}
                </span>
                <h2>{pane === "teacher" ? "林间老师" : "知识点记录"}</h2>
              </div>
              <button title="收起侧栏" onClick={() => setPane("")}>
                <X size={17} />
              </button>
            </header>
            {pane === "points" ? (
              <div className="knowledge-journal">
                <p className="muted">
                  知识点先保存为草稿，确认后进入复习中心。
                </p>
                <button
                  disabled={busy || !session}
                  onClick={() => void send("extract")}
                >
                  <Sparkles size={16} />
                  梳理当前章节 / 对话
                </button>
                {points.map((p) => (
                  <article className="journal-card" key={p.id}>
                    <small>
                      {stateLabel[p.state]} · {p.chapter}
                    </small>
                    <h3>{p.title}</h3>
                    <p>{p.question}</p>
                    <div>
                      <button onClick={() => setEditing(p)}>
                        {p.state === "draft" ? "审阅并确认" : "编辑"}
                      </button>
                      {p.state !== "draft" && (
                        <button
                          onClick={() => {
                            setSelectedPoint(p);
                            setPane("teacher");
                            setPage(p.locator);
                          }}
                        >
                          讲解这个知识点
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!points.length && (
                  <p className="muted">
                    完成阅读或讨论后，点击上方按钮整理知识点。
                  </p>
                )}
              </div>
            ) : (
              <>
                {selectedPoint && (
                  <div className="current-question">
                    <span>正在讲解 · {selectedPoint.title}</span>
                    <strong>{selectedPoint.question}</strong>
                    <button
                      className="text-button"
                      onClick={() => setSelectedPoint(null)}
                    >
                      切回自由答疑
                    </button>
                  </div>
                )}
                <div className="conversation" ref={scroll}>
                  {!session?.messages.length && (
                    <div className="teacher-intro">
                      <span className="teacher-emblem">知</span>
                      <h3>你好，我在这里。</h3>
                      <p>
                        你可以提问，也可以先讲讲自己的理解。我会简洁指出误区，陪你一步步想明白。
                      </p>
                    </div>
                  )}
                  {session?.messages.map((m, i) => (
                    <article key={i} className={"message " + m.role}>
                      <small>{m.role === "user" ? "我" : "林间老师"}</small>
                      <p>{m.content}</p>
                      {m.refs?.map((r, j) => (
                        <details className="source-ref" key={j}>
                          <summary
                            onClick={() => {
                              if (r.sourceId === item?.id)
                                record(r.page, total);
                            }}
                          >
                            <LinkIcon size={12} />
                            {r.title} · 跳转出处
                          </summary>
                          <p>{r.excerpt}</p>
                        </details>
                      ))}
                    </article>
                  ))}
                  {busy && (
                    <div className="teacher-thinking">
                      <LoaderCircle className="spin" size={15} />
                      老师正在思考…
                      <button
                        className="text-button"
                        onClick={() =>
                          void world("teacher-cancel", {
                            requestId: request.current,
                          })
                        }
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
                <form
                  className="teacher-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(selectedPoint ? "assess" : "chat");
                  }}
                >
                  <textarea
                    aria-label="对老师讲解或提问"
                    placeholder={
                      selectedPoint
                        ? "用自己的话讲解这个知识点…"
                        : "说说你的理解，或提出一个问题…"
                    }
                    rows={4}
                    maxLength={12000}
                    value={input}
                    disabled={!session}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === "Enter") {
                        e.preventDefault();
                        void send(selectedPoint ? "assess" : "chat");
                      }
                    }}
                  />
                  <div>
                    <button
                      type="button"
                      title="整理知识点草稿"
                      disabled={busy || !session}
                      onClick={() => {
                        setPane("points");
                        void send("extract");
                      }}
                    >
                      <NotebookPen size={15} />
                      整理草稿
                    </button>
                    <button
                      className="primary"
                      disabled={busy || !session || !input.trim()}
                    >
                      <Send size={15} />
                      {selectedPoint ? "提交讲解" : "发送"}
                    </button>
                  </div>
                  <small>
                    Ctrl + Enter 发送 ·{" "}
                    {session?.private || item?.private ? (
                      <>
                        <LockKeyhole size={10} /> 私密学习
                      </>
                    ) : (
                      "使用你配置的模型服务"
                    )}
                  </small>
                </form>
              </>
            )}
          </aside>
        )}
      </div>
      {editing && (
        <div className="world-overlay">
          <section className="world-dialog">
            <header>
              <h2>
                {editing.state === "draft" ? "审阅知识点草稿" : "编辑知识点"}
              </h2>
              <button title="关闭知识点编辑" onClick={() => setEditing(null)}>
                <X />
              </button>
            </header>
            <PointEditor
              key={editing.id}
              point={editing}
              notify={notify}
              onDone={() => {
                setEditing(null);
                void refresh();
              }}
            />
          </section>
        </div>
      )}
    </section>
  );
}
