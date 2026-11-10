import { useEffect, useState } from "react";
import {
  Search,
  Clock3,
  Play,
  Pause,
  Square,
  Users,
  Copy,
  Leaf,
  Gift,
  Coins,
  Droplets,
  Sparkles,
  LockKeyhole,
  Globe,
  BookOpen,
  Settings,
  LoaderCircle,
} from "lucide-react";
import type { Item, ListResult } from "./types";
import type { WorldState, Point, Plant, Chapter } from "./worldTypes";
import { world, stateLabel, timeLabel } from "./worldTypes";
import { Botanical } from "./GardenScene";
import { PointEditor } from "./StudyDesk";
import PdfReader from "./PdfReader";

type Common = {
  state: WorldState;
  notify: (s: string) => void;
  refresh: () => Promise<void>;
};
export function ReviewCenter({
  state,
  notify,
  refresh,
  onStudy,
}: { onStudy: (p: Point) => void } & Common) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("due"),
    [editing, setEditing] = useState<Point | null>(null),
    [open, setOpen] = useState<string | null>(null);
  const due = state.points.filter(
    (p) =>
      p.state !== "draft" &&
      (p.state === "consolidate" || (p.due !== null && p.due <= state.now)),
  );
  const points = state.points.filter(
    (p) =>
      (filter === "all" ||
        (filter === "due" && due.includes(p)) ||
        p.state === filter) &&
      (!query ||
        (p.title + p.question + p.chapter + p.source_title)
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <section className="review-center world-page">
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">KNOWLEDGE THAT STAYS</span>
          <h1>让理解，再生长一次。</h1>
          <p>用自己的话讲清楚，知识才真正属于你。</p>
        </div>
        <div className="metric-orb">
          <strong>{due.length}</strong>
          <span>待复习</span>
        </div>
      </header>
      <div className="review-controls">
        <div className="world-tabs">
          {[
            ["due", "今日推荐"],
            ["all", "全部知识点"],
            ["draft", "待确认草稿"],
            ["mastered", "已掌握"],
            ["consolidate", "待巩固"],
          ].map(([id, label]) => (
            <button
              className={filter === id ? "active" : ""}
              key={id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="world-search">
          <Search size={16} />
          <input
            aria-label="搜索知识点"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索知识点、问题或资料"
          />
        </label>
      </div>
      {filter === "due" && (
        <p className="review-description">
          按间隔复习计划推荐 · 提前练习可以进行，到期通过后才发放复习奖励。
        </p>
      )}
      <div className="point-grid">
        {points.map((p) => (
          <article className={"knowledge-card " + p.state} key={p.id}>
            <div className="card-overline">
              <span>
                {p.source_title || "自由学习"} · {p.chapter}
              </span>
              <span className={"state-badge " + p.state}>
                {stateLabel[p.state]}
              </span>
            </div>
            <h2>{p.title}</h2>
            <p className="point-question">{p.question}</p>
            <div className="point-meta">
              <span>
                {p.effective_private ? (
                  <>
                    <LockKeyhole size={12} />
                    私密
                  </>
                ) : (
                  <>
                    <Users size={12} />
                    好友可见
                  </>
                )}
              </span>
              <span>
                {p.due
                  ? "下次复习 " + new Date(p.due).toLocaleDateString("zh-CN")
                  : "尚未首次掌握"}
              </span>
            </div>
            {open === p.id && (
              <div className="reference-answer">{p.answer}</div>
            )}
            <footer>
              <button onClick={() => setEditing(p)}>
                {p.state === "draft" ? "审阅确认" : "编辑"}
              </button>
              <button onClick={() => setOpen(open === p.id ? null : p.id)}>
                {open === p.id ? "收起要点" : "参考要点"}
              </button>
              <button
                title="切换知识点私密状态"
                onClick={async () => {
                  try {
                    await world("privacy", {
                      type: "point",
                      id: p.id,
                      private: !p.effective_private,
                    });
                    await refresh();
                  } catch (e: any) {
                    notify(e.message);
                  }
                }}
              >
                {p.effective_private ? (
                  <LockKeyhole size={14} />
                ) : (
                  <Globe size={14} />
                )}
              </button>
              {p.state !== "draft" && (
                <button className="primary" onClick={() => onStudy(p)}>
                  向老师讲解
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>
      {!points.length && (
        <div className="world-empty">
          <Leaf size={36} />
          <h2>
            {filter === "due"
              ? "此刻，可以追随新的好奇。"
              : "这里还没有知识点。"}
          </h2>
          <p>
            {filter === "due"
              ? "暂时没有到期的复习。也可以到“全部知识点”自主练习。"
              : "阅读或讨论后，让老师整理草稿，确认后就会出现在这里。"}
          </p>
        </div>
      )}
      {editing && (
        <div className="world-overlay">
          <section className="world-dialog">
            <header>
              <h2>审阅与编辑知识点</h2>
              <button onClick={() => setEditing(null)}>关闭</button>
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

export function FocusPanel({ state, notify, refresh }: Common) {
  const [topic, setTopic] = useState(""),
    [sourceId, setSource] = useState(""),
    [items, setItems] = useState<Item[]>([]),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      void window.knowledge
        .call<ListResult>("list", { query, limit: 200 })
        .then((r) => setItems(r.items))
        .catch((e) => notify(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);
  const action = async (name: string) => {
    setBusy(true);
    try {
      if (name === "start")
        await world("focus-start", {
          topic:
            topic || items.find((i) => i.id === sourceId)?.title || "自由专注",
          sourceId: sourceId || null,
        });
      else await world("focus-control", { action: name });
      await refresh();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const records = state.focusRecords;
  const total = records.reduce((n, r) => n + r.seconds, 0),
    today = records
      .filter(
        (r) =>
          new Date(r.ended_at).toDateString() === new Date().toDateString(),
      )
      .reduce((n, r) => n + r.seconds, 0);
  return (
    <section className="focus-page world-page">
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">A LITTLE TIME, WELL SPENT</span>
          <h1>把时间，交给眼前。</h1>
          <p>读书、思考、动手实践。每一段投入，都值得被记住。</p>
        </div>
        <Clock3 size={38} />
      </header>
      <div className="focus-columns">
        <section className="focus-clock-card">
          <span className="eyebrow">
            {state.focus?.paused
              ? "PAUSED"
              : state.focus
                ? "IN FOCUS"
                : "READY WHEN YOU ARE"}
          </span>
          <div className="large-clock">
            {timeLabel(state.focus?.seconds || 0)}
          </div>
          <h2>{state.focus?.topic || "开始一段自己的时间"}</h2>
          {state.focus ? (
            <div className="clock-actions">
              <button
                disabled={busy}
                className="primary"
                onClick={() =>
                  void action(state.focus!.paused ? "resume" : "pause")
                }
              >
                {state.focus.paused ? <Play size={16} /> : <Pause size={16} />}{" "}
                {state.focus.paused ? "继续" : "暂停"}
              </button>
              <button disabled={busy} onClick={() => void action("stop")}>
                <Square size={15} />
                结束并保存
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action("start");
              }}
            >
              <input
                aria-label="专注主题"
                placeholder="这段时间，准备做什么？"
                value={topic}
                maxLength={200}
                onChange={(e) => setTopic(e.target.value)}
              />
              <input
                aria-label="查找关联资料"
                placeholder="查找要关联的资料（可选）"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="关联学习资料"
                value={sourceId}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">不关联资料 · 自由活动</option>
                {items.map((i) => (
                  <option value={i.id} key={i.id}>
                    {i.title}
                  </option>
                ))}
              </select>
              <button className="primary" disabled={busy}>
                <Play size={16} />
                开始专注
              </button>
            </form>
          )}
          <p className="focus-seed-hint">
            <Gift size={16} />
            每完成 45 分钟有效专注，都有机会遇见一颗奇怪的种子。
          </p>
        </section>
        <section>
          <div className="focus-metrics">
            <article>
              <span>今天已记录</span>
              <strong>
                {Math.floor(today / 60)} <small>分钟</small>
              </strong>
            </article>
            <article>
              <span>近期已记录</span>
              <strong>
                {Math.floor(total / 60)} <small>分钟</small>
              </strong>
            </article>
          </div>
          <h3>学习投入分布</h3>
          <div className="focus-distribution">
            {state.focusSummary?.map((s, i) => (
              <article key={i}>
                <span>{s.label}</span>
                <div>
                  <i
                    style={{
                      width:
                        Math.max(
                          2,
                          (s.seconds /
                            Math.max(
                              state.focusSummary?.[0]?.seconds || 1,
                              1,
                            )) *
                            100,
                        ) + "%",
                    }}
                  />
                </div>
                <small>{Math.floor(s.seconds / 60)} 分钟</small>
              </article>
            ))}
          </div>
          <h3>
            时间留下的足迹 <small className="muted">最近 500 段</small>
          </h3>
          <div className="focus-history">
            {records.map((r) => (
              <article key={r.id}>
                <div>
                  <strong>{r.topic}</strong>
                  <small>
                    {new Date(r.started_at).toLocaleString("zh-CN")}
                    {r.source_id
                      ? " · " + (r.source_title || "原资料已移除")
                      : ""}
                  </small>
                </div>
                <span>{timeLabel(r.seconds)}</span>
              </article>
            ))}
            {!records.length && (
              <p className="muted">结束第一段专注后，记录将保存在这里。</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

export function FriendsPanel({ state, notify, refresh }: Common) {
  const s = state.social;
  const [url, setUrl] = useState(s.url),
    [code, setCode] = useState(""),
    [name, setName] = useState(state.profile.name),
    [busy, setBusy] = useState(false);
  const act = async (action: string, payload?: any) => {
    setBusy(true);
    try {
      await world(action, payload);
      await refresh();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="friends-page world-page">
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">GOOD COMPANY, QUIET MOMENTS</span>
          <h1>有人同行，也能安静学习。</h1>
          <p>邀请好友来到你的小屋，让家成为彼此的自习室。</p>
        </div>
        <span className={"connection-badge " + s.status}>
          {s.status === "online"
            ? "自习服务已连接"
            : s.status === "connecting"
              ? "正在连接"
              : "尚未连接自习服务"}
        </span>
      </header>
      <div className="friends-columns">
        <section className="paper-panel">
          <h2>我的旅人身份</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act("garden", { action: "rename", name });
            }}
          >
            <label>
              称呼
              <input
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button disabled={busy}>保存称呼</button>
          </form>
          <p className="muted">
            无需注册。身份保存在本机，请随知识库一起备份。
          </p>
          <label>
            我的好友码
            <textarea
              aria-label="我的好友码"
              readOnly
              rows={4}
              value={s.code || "连接自习服务后可复制好友码"}
            />
          </label>
          <button
            disabled={!s.code}
            onClick={() =>
              void world("copy-code")
                .then(() => notify("好友码已复制"))
                .catch((e) => notify(e.message))
            }
          >
            <Copy size={15} />
            复制好友码
          </button>
          <hr />
          <h3>连接自习服务</h3>
          <p>
            好友需要连接到同一个服务。可在局域网启动，也可填写自己部署的公网服务地址。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act("social-connect", { url });
            }}
          >
            <input
              aria-label="自习服务地址"
              placeholder="wss://你的自习服务地址"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="primary" disabled={busy || !url}>
              连接
            </button>
          </form>
          <div className="button-row">
            <button disabled={busy} onClick={() => void act("social-local")}>
              启动局域网自习服务
            </button>
            <button
              disabled={s.status === "offline"}
              onClick={() => void act("social-disconnect")}
            >
              断开
            </button>
          </div>
          {s.url && <p className="muted">当前服务：{s.url}</p>}
          {s.localAddresses.length > 0 && (
            <details>
              <summary>本机局域网地址</summary>
              {s.localAddresses.map((a) => (
                <p key={a}>{a}</p>
              ))}
            </details>
          )}
          {s.error && <p className="inline-error">{s.error}</p>}
        </section>
        <section>
          <div className="paper-panel">
            <h2>添加好友</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act("social-add", { code });
              }}
            >
              <textarea
                aria-label="输入好友码"
                placeholder="粘贴好友码；双方先连接到同一自习服务"
                rows={3}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                className="primary"
                disabled={busy || !code || s.status !== "online"}
              >
                发送好友请求
              </button>
            </form>
          </div>
          {s.requests.map((r) => (
            <article className="friend-row" key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <small>希望与你成为好友</small>
              </div>
              <button
                disabled={busy}
                onClick={() => void act("social-accept", { id: r.id })}
              >
                接受
              </button>
            </article>
          ))}
          {s.invitations.map((r) => (
            <article className="friend-row invitation" key={r.id}>
              <div>
                <strong>{r.name} 邀请你做客</strong>
                <small>加入对方的小屋，一起学习。</small>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act("social-join", { id: r.id }).then(() =>
                    notify("已进入好友家园，返回家园即可看到"),
                  )
                }
              >
                接受邀请
              </button>
            </article>
          ))}
          <h2>
            好友 <small>{s.friends.length}</small>
          </h2>
          {s.friends.map((f) => (
            <article className="friend-row" key={f.id}>
              <span className={"presence-dot " + (f.online ? "online" : "")} />
              <div>
                <strong>{f.name}</strong>
                <small>
                  {f.online ? "在线" : "离线"}
                  {f.online && f.focus
                    ? " · " +
                      (f.focus.paused ? "已暂停 " : "专注中 ") +
                      timeLabel(f.focus.seconds)
                    : ""}
                </small>
              </div>
              <button
                disabled={busy || !f.online || !!s.hostId}
                onClick={() =>
                  void act("social-invite", { id: f.id }).then(() =>
                    notify("邀请已发送"),
                  )
                }
              >
                邀请来家中学习
              </button>
            </article>
          ))}
          {!s.friends.length && (
            <div className="world-empty">
              <Users size={30} />
              <p>交换好友码，邀请一位同行者。</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export function TeacherSettings({ notify }: { notify: (s: string) => void }) {
  const [url, setUrl] = useState(""),
    [model, setModel] = useState(""),
    [key, setKey] = useState(""),
    [hasKey, setHasKey] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void world("teacher-info")
      .then((c) => {
        setUrl(c.baseUrl);
        setModel(c.model);
        setHasKey(c.hasKey);
      })
      .catch((e) => notify(e.message));
  }, []);
  return (
    <form
      className="teacher-settings point-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const c = await world("teacher-config", { baseUrl: url, model, key });
          setHasKey(c.hasKey);
          setKey("");
          notify("老师配置已保存");
        } catch (e: any) {
          notify(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        支持兼容 Chat Completions
        的模型服务，也可接入本机模型。使用老师时，会将当前讨论及相关原文发送给你配置的服务。
      </p>
      <label>
        API 地址
        <input
          aria-label="API 地址"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://服务地址/v1"
        />
      </label>
      <label>
        模型名称
        <input
          aria-label="模型名称"
          required
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="填写服务商提供的模型 ID"
        />
      </label>
      <label>
        API Key
        <input
          aria-label="API Key"
          type="password"
          value={key}
          autoComplete="off"
          onChange={(e) => setKey(e.target.value)}
          placeholder={
            hasKey ? "已安全保存，留空保持不变" : "本机免密模型可留空"
          }
        />
      </label>
      <p className="muted">
        密钥使用系统凭据加密，独立保存在本机，不向好友分享，也不随知识库备份导出。迁移设备后需重新填写。
      </p>
      <div className="button-row">
        <button
          type="button"
          disabled={busy || !hasKey}
          onClick={async () => {
            setBusy(true);
            try {
              await world("teacher-config", {
                baseUrl: url,
                model,
                clearKey: true,
              });
              setHasKey(false);
              setKey("");
              notify("已移除保存的密钥");
            } catch (e: any) {
              notify(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          移除已保存的密钥
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "保存中…" : "保存老师配置"}
        </button>
      </div>
    </form>
  );
}

export function ShopPanel({
  state,
  onReward,
  notify,
  refresh,
  gacha = false,
}: Common & { onReward: (r: any) => void; gacha?: boolean }) {
  const [busy, setBusy] = useState(false);
  const buy = async (species?: string) => {
    setBusy(true);
    try {
      if (gacha) await new Promise((resolve) => setTimeout(resolve, 650));
      const r = await world("garden", {
        action: gacha ? "gacha" : "buy",
        species,
      });
      onReward(r);
      await refresh();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (gacha)
    return (
      <div className="gacha-panel">
        <div className={"gacha-machine " + (busy ? "turning" : "")}>
          <div className="gacha-globe">
            {Array.from({ length: 8 }, (_, i) => (
              <i
                key={i}
                style={{
                  left: 15 + (i % 4) * 20 + "%",
                  top: 30 + Math.floor(i / 4) * 30 + "%",
                  background: state.species[i % 6].color,
                }}
              />
            ))}
          </div>
          <div className="gacha-body">
            <Gift size={45} />
            <span>FOREST SEEDS</span>
            <i />
          </div>
        </div>
        <h2>让好奇，转动一次。</h2>
        <p>一颗奇怪的种子，会长成怎样的生命？</p>
        <button
          className="primary"
          disabled={busy || state.profile.coins < state.rules.gachaCoins}
          onClick={() => void buy()}
        >
          <Coins size={17} />
          {state.rules.gachaCoins} 金币 · 转动把手
        </button>
        <small>当前金币 {state.profile.coins} · 种下并成长后揭晓品种</small>
      </div>
    );
  return (
    <>
      <p className="muted">
        欢迎来到苔藓商人的小铺。每一颗种子，都在等一位耐心的园丁。
      </p>
      <div className="seed-shop">
        {state.species.map((s) => (
          <article key={s.id}>
            <Botanical species={s} />
            <div>
              <h3>{s.name}</h3>
              <p>{s.description}</p>
              <button
                disabled={busy || state.profile.coins < s.price}
                onClick={() => void buy(s.id)}
              >
                <Coins size={14} />
                {s.price} 金币 · 购买
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
export function PlantCare({
  plant,
  state,
  notify,
  refresh,
  onMove,
  onClose,
}: Common & { plant: Plant; onMove: () => void; onClose: () => void }) {
  const current = state.profile.plants.find((p) => p.id === plant.id) || plant;
  const s = state.species.find((s) => s.id === current.species)!;
  const care = async (action: string) => {
    try {
      await world("garden", { action, id: plant.id });
      await refresh();
      if (action === "remove") onClose();
      else notify("已完成照料");
    } catch (e: any) {
      notify(e.message);
    }
  };
  return (
    <div className="plant-care">
      <Botanical species={s} growth={current.growth} dead={current.dead} />
      <h2>
        {current.mystery && current.growth < 0.4
          ? "正在生长的神秘植物"
          : s.name}
      </h2>
      <p>
        {current.dead
          ? "它已经永久枯萎，新的种子可以在这里重新生长。"
          : current.mystery && current.growth < 0.4
            ? "再给它一点时间，答案正藏在新叶里。"
            : s.description}
      </p>
      <p className="muted">
        {current.dead
          ? "连续七天未获照料"
          : `成长 ${Math.round(current.growth * 100)}% · 上次照料 ${new Date(current.caredAt).toLocaleString("zh-CN")}`}
      </p>
      <div className="button-row">
        {current.dead ? (
          <button onClick={() => void care("remove")}>移除枯株</button>
        ) : (
          <>
            <button onClick={() => void care("water")}>
              <Droplets size={15} />
              浇水 · 1 水
            </button>
            <button onClick={() => void care("fertilize")}>
              <Sparkles size={15} />
              施肥 · 1 肥料
            </button>
            <button onClick={() => void care("prune")}>修剪</button>
            <button onClick={onMove}>重新摆放</button>
          </>
        )}
      </div>
    </div>
  );
}

export function SharedLibrary({
  state,
  notify,
}: Pick<Common, "state" | "notify">) {
  const room = state.social.room;
  const [doc, setDoc] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("items"),
    [chapters, setChapters] = useState<Chapter[]>([]),
    [catalog, setCatalog] = useState<any>(
      room?.catalog || { items: [], points: [], itemCount: 0, pointCount: 0 },
    ),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!room) return;
    let current = true;
    const timer = setTimeout(() => {
      void world("social-catalog", { query, offset })
        .then((c) => {
          if (current) setCatalog(c);
        })
        .catch((e) => {
          if (current) notify(e.message);
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [room, query, offset]);
  useEffect(() => {
    if (doc && !catalog.items.some((i: any) => i.id === doc.id)) setDoc(null);
  }, [catalog, doc?.id]);
  useEffect(
    () => () => {
      for (const url of doc?.urls || []) URL.revokeObjectURL(url);
    },
    [doc],
  );
  const imageURL = (file: any) => {
    if (!["png", "jpg", "jpeg", "webp", "gif"].includes(file.ext))
      throw Error("不支持的共享图片格式");
    return URL.createObjectURL(
      new Blob([new Uint8Array(file.bytes)], {
        type: "image/" + (file.ext === "jpg" ? "jpeg" : file.ext),
      }),
    );
  };
  const read = async (item: Pick<Item, "id" | "title" | "kind">) => {
    setBusy(true);
    try {
      if (item.kind === "pdf") {
        const file = await world("social-file", { id: item.id });
        setDoc({ ...file, id: item.id });
      } else if (item.kind === "epub") {
        const file = await world("social-file", { id: item.id });
        const cs = await world<Chapter[]>("epub-bytes", { bytes: file.bytes });
        setChapters(cs);
        setDoc({ ...file, id: item.id, page: 1 });
      } else if (item.kind === "image") {
        const file = await world("social-file", { id: item.id }),
          url = imageURL(file);
        setDoc({ ...file, id: item.id, url, urls: [url] });
      } else {
        const content = await world("social-document", {
          id: item.id,
          page: 1,
        });
        const urls: string[] = [];
        if (content.html) {
          const document = new DOMParser().parseFromString(
            content.html,
            "text/html",
          );
          for (const img of document.querySelectorAll<HTMLImageElement>(
            "img[data-asset]",
          )) {
            const file = await world("social-file", {
              id: item.id,
              asset: img.dataset.asset,
            });
            const url = imageURL(file);
            urls.push(url);
            img.src = url;
            img.removeAttribute("data-asset");
          }
          content.html = document.body.innerHTML;
        }
        setDoc({ ...content, id: item.id, urls });
      }
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!room)
    return (
      <div className="world-empty">
        <Users />
        <p>请先接受邀请，进入好友家园。</p>
      </div>
    );
  return (
    <section className="shared-library world-page">
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">A FRIEND'S BOOKSHELF</span>
          <h1>{room.owner.name}的书架</h1>
          <p>这里展示主人向好友开放的资料与知识点。</p>
        </div>
      </header>
      <div className="world-search">
        <Search size={16} />
        <input
          aria-label="搜索好友共享内容"
          placeholder="搜索共享资料和知识点"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <div className="world-tabs">
        <button
          className={tab === "items" ? "active" : ""}
          onClick={() => setTab("items")}
        >
          共享资料
        </button>
        <button
          className={tab === "points" ? "active" : ""}
          onClick={() => setTab("points")}
        >
          共享知识点
        </button>
      </div>
      {tab === "items" ? (
        <div className="shared-columns">
          <aside>
            {catalog.items.map((i: Pick<Item, "id" | "title" | "kind">) => (
              <button disabled={busy} key={i.id} onClick={() => void read(i)}>
                <BookOpen size={15} />
                {i.title}
                <small>{i.kind.toUpperCase()}</small>
              </button>
            ))}
          </aside>
          <main>
            {busy ? (
              <div className="world-empty">
                <LoaderCircle className="spin" />
                正在从好友家园读取资料…
              </div>
            ) : doc?.kind === "pdf" ? (
              <PdfReader asset={"guest:" + doc.id} bytes={doc.bytes} />
            ) : doc?.kind === "epub" ? (
              <>
                <div className="chapter-toolbar">
                  <select
                    aria-label="好友电子书章节"
                    value={doc.page}
                    onChange={(e) =>
                      setDoc({ ...doc, page: Number(e.target.value) })
                    }
                  >
                    {chapters.map((c) => (
                      <option key={c.page} value={c.page}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>
                <article
                  className="epub-page"
                  dangerouslySetInnerHTML={{
                    __html: chapters[doc.page - 1]?.html || "",
                  }}
                />
              </>
            ) : doc?.kind === "image" ? (
              <div className="image-preview">
                <img src={doc.url} alt={doc.title} />
              </div>
            ) : doc ? (
              <article className="epub-page">
                <h2>{doc.title}</h2>
                {doc.kind === "word" ? (
                  <div>
                    <p>{doc.text}</p>
                    <button
                      onClick={() =>
                        void world("social-download", { id: doc.id })
                          .then((file) => {
                            if (file) notify("原文已保存：" + file);
                          })
                          .catch((e) => notify(e.message))
                      }
                    >
                      保存 Word 原文件
                    </button>
                  </div>
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: doc.html || "" }} />
                )}
              </article>
            ) : (
              <div className="world-empty">
                <BookOpen size={30} />
                <p>选择一本书，看看好友正在探索什么。</p>
              </div>
            )}
          </main>
        </div>
      ) : (
        <div className="point-grid">
          {catalog.points.map(
            (
              p: Pick<
                Point,
                "id" | "title" | "question" | "answer" | "chapter" | "source_id"
              >,
            ) => (
              <article className="knowledge-card" key={p.id}>
                <small>{p.chapter}</small>
                <h2>{p.title}</h2>
                <p>{p.question}</p>
                <details
                  onToggle={(e) => {
                    if (e.currentTarget.open && !answers[p.id])
                      void world("social-point", { id: p.id })
                        .then((point) =>
                          setAnswers((a) => ({ ...a, [p.id]: point.answer })),
                        )
                        .catch((e) => notify(e.message));
                  }}
                >
                  <summary>查看参考要点</summary>
                  <p>{answers[p.id] || "正在读取…"}</p>
                </details>
              </article>
            ),
          )}
        </div>
      )}
      <div className="shared-pagination">
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          上一页
        </button>
        <span>
          第 {Math.floor(offset / 100) + 1} 页 · 共{" "}
          {tab === "items" ? catalog.itemCount : catalog.pointCount} 项
        </span>
        <button
          disabled={
            offset + 100 >=
            (tab === "items" ? catalog.itemCount : catalog.pointCount)
          }
          onClick={() => setOffset(offset + 100)}
        >
          下一页
        </button>
      </div>
    </section>
  );
}
