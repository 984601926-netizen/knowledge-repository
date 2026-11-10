import { useCallback, useEffect, useRef, useState } from "react";
import {
  Leaf,
  House,
  BookOpen,
  ListTree,
  Clock3,
  Users,
  Settings,
  ArrowLeft,
  Coins,
  Droplets,
  Sparkles,
  Package,
  Gift,
  X,
  LogOut,
  LoaderCircle,
  NotebookPen,
  Play,
} from "lucide-react";
import LibraryApp from "./App";
import GardenScene from "./GardenScene";
import StudyDesk from "./StudyDesk";
import {
  ReviewCenter,
  FocusPanel,
  FriendsPanel,
  TeacherSettings,
  ShopPanel,
  PlantCare,
  SharedLibrary,
} from "./WorldPanels";
import { world, timeLabel } from "./worldTypes";
import type { WorldState, Point, Plant } from "./worldTypes";
import type { Item } from "./types";

type View =
  "world" | "library" | "study" | "review" | "focus" | "friends" | "shared";
export default function WorldApp() {
  const [data, setData] = useState<WorldState | null>(null),
    [view, setView] = useState<View>("world"),
    [scene, setScene] = useState("garden"),
    [selected, setSelected] = useState<Item | null>(null),
    [sessionId, setSessionId] = useState<string | null>(null),
    [point, setPoint] = useState<Point | null>(null),
    [modal, setModal] = useState<string | null>(null),
    [plant, setPlant] = useState<Plant | null>(null),
    [placement, setPlacement] = useState<{ action: string; id: string } | null>(
      null,
    ),
    [reward, setReward] = useState<any>(null),
    [opened, setOpened] = useState(false),
    [toast, setToast] = useState(""),
    [error, setError] = useState("");
  const flush = useRef<() => Promise<boolean>>(async () => true),
    seq = useRef(0),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    dataRef = useRef(data),
    viewRef = useRef(view);
  dataRef.current = data;
  viewRef.current = view;
  const notify = useCallback((s: string) => {
    setToast(s.replace(/^Error invoking remote method '[^']+': Error: /, ""));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }, []);
  const refresh = useCallback(async () => {
    const n = ++seq.current;
    try {
      const next = await world<WorldState>("state");
      if (n === seq.current) {
        setData(next);
        setError("");
      }
    } catch (e: any) {
      if (n === seq.current) setError(e.message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (data?.social.hostId) {
      setView("world");
      setScene("home");
    }
  }, [data?.social.hostId]);
  useEffect(() => {
    void world("activity", {
      seated:
        view === "study" ||
        view === "shared" ||
        (view === "focus" && !!data?.focus && !data.focus.paused),
    }).catch(() => {});
  }, [view, Boolean(data?.focus), data?.focus?.paused]);
  const registerFlush = useCallback((fn: () => Promise<boolean>) => {
    flush.current = fn;
  }, []);
  useEffect(
    () =>
      window.knowledge.onClose(() => {
        void flush
          .current()
          .then((ok) => {
            if (ok) return window.knowledge.call("close-ready");
            notify("关闭已取消，请先重试保存。");
          })
          .catch((e) => notify("关闭已取消：" + e.message));
      }),
    [notify],
  );
  useEffect(() => {
    if (!modal && !reward) return;
    const before = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const overlay = [...document.querySelectorAll(".world-overlay")].at(-1);
      (
        overlay?.querySelector(
          "button:not(:disabled),input,textarea",
        ) as HTMLElement | null
      )?.focus();
    }, 0);
    const handler = (e: KeyboardEvent) => {
      const overlay = [...document.querySelectorAll(".world-overlay")].at(-1);
      if (!overlay) return;
      if (e.key === "Escape" && !reward) {
        e.preventDefault();
        setModal(null);
      }
      if (e.key === "Tab") {
        const elements = [
          ...overlay.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
          ),
        ];
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handler, true);
      if (before?.isConnected) before.focus();
    };
  }, [modal, Boolean(reward)]);
  const navigate = async (next: View) => {
    if (viewRef.current === "library" && !(await flush.current())) return;
    setView(next);
  };
  const giveReward = (r: any) => {
    setReward(r);
    setOpened(false);
  };
  useEffect(() => {
    if (!reward && data?.focusRewards?.length) {
      setReward(data.focusRewards[0]);
      setOpened(false);
    }
  }, [data?.focusRewards, reward]);
  const openStudy = async (item?: Item | null, p?: Point | null) => {
    if (!(await flush.current())) return;
    try {
      const sourceId = p?.source_id || item?.id || null;
      let source = item;
      if (sourceId && !source)
        source = await window.knowledge.call<Item>("get", { id: sourceId });
      if (source?.kind === "word") {
        await world("word-open", { id: source.id });
        return;
      }
      const topic = source?.title || p?.chapter || "";
      const existing = dataRef.current?.sessions.find(
        (s) => s.source_id === sourceId && (sourceId || s.topic === topic),
      );
      let id = existing?.id || null;
      if (!id && (sourceId || p)) {
        const s = await world("session", { sourceId, topic });
        id = s.id;
      }
      setSessionId(id);
      setPoint(p || null);
      setView("study");
      await refresh();
    } catch (e: any) {
      notify(e.message);
    }
  };
  const changeScene = (next: string) => {
    setScene(next);
    if (!dataRef.current?.social.hostId)
      void world("garden", { action: "scene", scene: next }).catch((e) =>
        notify(e.message),
      );
    void world("social-pose", { x: 50, scene: next }).catch(() => {});
  };
  const interact = (kind: string) => {
    if (kind === "library") {
      void navigate(dataRef.current?.social.hostId ? "shared" : "library");
      return;
    }
    if (kind === "study") {
      void openStudy(selected);
      return;
    }
    if (dataRef.current?.social.hostId) {
      notify("商店和种植请回自己的家园操作");
      return;
    }
    setModal(kind);
  };
  const put = async (x: number) => {
    if (!placement) return;
    try {
      await world("garden", { ...placement, x });
      setPlacement(null);
      await refresh();
      notify(
        placement.action === "plant"
          ? "种子已种下，新的生命开始生长"
          : "植物已重新摆放",
      );
    } catch (e: any) {
      notify(e.message);
    }
  };
  const pickPlant = (p: Plant) => {
    setPlant(p);
    setModal("plant");
  };
  const startPlacement = (action: string, id: string) => {
    setPlacement({ action, id });
    setModal(null);
    setScene("garden");
    setView("world");
  };
  return (
    <div className="world-app">
      <header className="world-topbar">
        <button className="world-brand" onClick={() => void navigate("world")}>
          <span>
            <Leaf size={23} />
          </span>
          <div>
            <strong>
              拾知 <i>林间学园</i>
            </strong>
            <small>GROW A LITTLE, EVERY DAY</small>
          </div>
        </button>
        <nav aria-label="学园导航">
          {(
            [
              { id: "world", label: "家园", icon: House },
              { id: "library", label: "书架", icon: BookOpen },
              { id: "study", label: "书桌", icon: NotebookPen },
              { id: "review", label: "知识与复习", icon: ListTree },
              { id: "focus", label: "专注", icon: Clock3 },
              { id: "friends", label: "好友", icon: Users },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              onClick={() => {
                if (n.id === "study") void openStudy(selected);
                else void navigate(n.id);
              }}
            >
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.id === "friends" &&
                !!data &&
                data.social.requests.length + data.social.invitations.length >
                  0 && (
                  <b className="notification-count">
                    {data.social.requests.length +
                      data.social.invitations.length}
                  </b>
                )}
            </button>
          ))}
        </nav>
        <button
          className="world-settings-button"
          title="智能体老师设置"
          onClick={() => setModal("teacher")}
        >
          <Settings size={19} />
        </button>
      </header>
      {data ? (
        <>
          <div className="world-statusbar">
            <div>
              <span className="status-leaf">✦</span>
              {data.social.hostId
                ? data.social.room?.owner.name + "的家园"
                : data.profile.name + "的林间家园"}
              <span className="status-divider" />
              个人资料保存在本机
            </div>
            <div className="resource-bar">
              <span title="学习金币">
                <Coins size={15} />
                {data.profile.coins}
              </span>
              <span title="浇水资源">
                <Droplets size={15} />
                {data.profile.water}
              </span>
              <span title="肥料">
                <Sparkles size={15} />
                {data.profile.fertilizer}
              </span>
              <button onClick={() => setModal("bag")}>
                <Package size={16} />
                种子袋 {data.profile.seeds.length}
              </button>
              {data.focus && (
                <button
                  onClick={() => void navigate("focus")}
                  className="mini-focus"
                >
                  <span
                    className={
                      "presence-dot " + (!data.focus.paused ? "online" : "")
                    }
                  />
                  {timeLabel(data.focus.seconds)}
                </button>
              )}
            </div>
          </div>
          <div className="world-body">
            <div
              className="library-host"
              style={{ display: view === "library" ? "block" : "none" }}
            >
              <LibraryApp
                worldState={data}
                manageClose={false}
                active={view === "library"}
                onSelection={setSelected}
                registerFlush={registerFlush}
                onStudy={(item) => void openStudy(item)}
              />
            </div>
            {view === "world" && (
              <>
                <GardenScene
                  state={data}
                  scene={scene}
                  onScene={changeScene}
                  onInteract={interact}
                  onPlant={pickPlant}
                  placement={!!placement}
                  onPlace={(x) => void put(x)}
                />
                <div className="world-floating-actions">
                  {data.social.hostId ? (
                    <>
                      <button
                        onClick={() =>
                          void world("social-leave")
                            .then(refresh)
                            .then(() => notify("已返回自己的家园"))
                        }
                      >
                        <LogOut size={16} />
                        返回自己的家园
                      </button>
                      <button onClick={() => void navigate("shared")}>
                        <BookOpen size={16} />
                        好友的书架
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() =>
                        changeScene(scene === "garden" ? "home" : "garden")
                      }
                    >
                      <House size={16} />
                      {scene === "garden" ? "进入小屋" : "回到花园"}
                    </button>
                  )}
                  {placement ? (
                    <button onClick={() => setPlacement(null)}>取消摆放</button>
                  ) : (
                    <button onClick={() => void navigate("focus")}>
                      <Clock3 size={16} />
                      {data.focus ? "查看专注" : "开始专注"}
                    </button>
                  )}
                </div>
              </>
            )}
            {view === "study" && (
              <StudyDesk
                state={data}
                initialSessionId={sessionId}
                initialPoint={point}
                onLibrary={() => void navigate("library")}
                onReward={giveReward}
                refresh={refresh}
                notify={notify}
              />
            )}
            {view === "review" && (
              <ReviewCenter
                state={data}
                notify={notify}
                refresh={refresh}
                onStudy={(p) => void openStudy(null, p)}
              />
            )}
            {view === "focus" && (
              <FocusPanel state={data} notify={notify} refresh={refresh} />
            )}
            {view === "friends" && (
              <FriendsPanel state={data} notify={notify} refresh={refresh} />
            )}
            {view === "shared" && (
              <SharedLibrary state={data} notify={notify} />
            )}
          </div>
          <footer className="world-footer">
            <span>
              <Leaf size={12} />
              {view === "world"
                ? "森林不会催促你，理解会慢慢发生。"
                : "读过的，想过的，都可以在这里生根。"}
            </span>
            <span>
              {data.social.status === "online" ? (
                <>
                  <span className="presence-dot online" />
                  {data.social.friends.filter((f) => f.online).length}{" "}
                  位好友在线
                </>
              ) : (
                <>
                  <span className="presence-dot" />
                  个人模式
                </>
              )}
              {data.social.guests.length > 0 &&
                ` · ${data.social.guests.length} 位好友做客`}
            </span>
          </footer>
          {modal && (
            <div
              className="world-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) setModal(null);
              }}
            >
              <section
                className={
                  "world-dialog " +
                  (["shop", "bag"].includes(modal) ? "wide" : "")
                }
                role="dialog"
                aria-modal="true"
                aria-label={
                  {
                    teacher: "智能体老师配置",
                    shop: "种子商店",
                    gacha: "森林扭蛋机",
                    bag: "我的种子袋",
                    plant: "照料植物",
                  }[modal] || "学园"
                }
              >
                <header>
                  <div>
                    <span className="eyebrow">A SMALL PART OF YOUR WORLD</span>
                    <h2>
                      {
                        {
                          teacher: "与老师连接",
                          shop: "苔藓商人的种子铺",
                          gacha: "森林扭蛋机",
                          bag: "收藏未知的生命",
                          plant: "照料这一份生长",
                        }[modal]
                      }
                    </h2>
                  </div>
                  <button title="关闭弹窗" onClick={() => setModal(null)}>
                    <X size={20} />
                  </button>
                </header>
                {modal === "teacher" && <TeacherSettings notify={notify} />}
                {(modal === "shop" || modal === "gacha") && (
                  <ShopPanel
                    state={data}
                    notify={notify}
                    refresh={refresh}
                    onReward={giveReward}
                    gacha={modal === "gacha"}
                  />
                )}
                {modal === "plant" && plant && (
                  <PlantCare
                    state={data}
                    plant={plant}
                    notify={notify}
                    refresh={refresh}
                    onMove={() => startPlacement("move", plant.id)}
                    onClose={() => setModal(null)}
                  />
                )}
                {modal === "bag" && (
                  <>
                    <p className="muted">
                      首次到来赠送两颗种子。之后的惊喜，藏在你的学习、复习和专注里。
                    </p>
                    <div className="seed-bag">
                      {data.profile.seeds.map((seed) => (
                        <article key={seed.id}>
                          <div
                            className={
                              "seed-token " + (seed.mystery ? "mystery" : "")
                            }
                          >
                            <Leaf size={35} />
                            <i />
                          </div>
                          <h3>
                            {seed.mystery
                              ? "奇怪的种子"
                              : data.species.find((s) => s.id === seed.species)
                                  ?.name}
                          </h3>
                          <p>
                            {seed.mystery
                              ? "种下之后，让时间告诉你答案。"
                              : "一份已经认识，仍值得期待的生命。"}
                          </p>
                          <button
                            disabled={!!data.social.hostId}
                            className="primary"
                            onClick={() => startPlacement("plant", seed.id)}
                          >
                            选择位置种下
                          </button>
                        </article>
                      ))}
                    </div>
                    {!data.profile.seeds.length && (
                      <div className="world-empty">
                        <Leaf />
                        <p>种子袋空了。掌握一个新知识点，或去商店看看。</p>
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
          {reward && (
            <div className="world-overlay reward-overlay">
              <section
                className={"reward-card " + (opened ? "opened" : "")}
                role="dialog"
                aria-label="学习奖励"
              >
                <span className="eyebrow">SOMETHING WONDERFUL HAS GROWN</span>
                <h2>{reward.label || "理解，值得被庆祝。"}</h2>
                <button
                  className="reward-package"
                  aria-label="亲手打开奖励"
                  title="亲手打开奖励"
                  onClick={() => setOpened(true)}
                  disabled={opened}
                >
                  <Gift size={72} />
                  <span>{opened ? "✦" : "点击，打开这份惊喜"}</span>
                </button>
                {opened ? (
                  <>
                    <h3>
                      {reward.seed
                        ? reward.seed.mystery
                          ? "一颗奇怪的种子"
                          : data.species.find(
                              (s) => s.id === reward.seed.species,
                            )?.name
                        : "滋养下一次生长"}
                    </h3>
                    <p>
                      {reward.seed
                        ? "它已经放进种子袋，种下后会慢慢揭晓。"
                        : `水 +${reward.water || 0} · 肥料 +${reward.fertilizer || 0}`}
                      {reward.coins ? ` · 金币 +${reward.coins}` : ""}
                    </p>
                    <button
                      className="primary"
                      onClick={async () => {
                        try {
                          if (reward.eventId)
                            await world("reward-ack", { id: reward.eventId });
                          await refresh();
                          setReward(null);
                        } catch (e: any) {
                          notify(e.message);
                        }
                      }}
                    >
                      收好，继续探索
                    </button>
                  </>
                ) : (
                  <p>每一次认真理解，都会留下新的可能。</p>
                )}
              </section>
            </div>
          )}
        </>
      ) : (
        <div className="world-loading">
          <LoaderCircle className="spin" size={32} />
          <h2>正在打开你的林间家园…</h2>
          {error && (
            <>
              <p>{error}</p>
              <button onClick={() => void refresh()}>重试</button>
            </>
          )}
        </div>
      )}
      {toast && (
        <div className="world-toast" role="status">
          {toast}
          <button title="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {data && (error || data.warning) && (
        <div className="world-toast error" role="alert">
          {error || data.warning}
          <button onClick={() => void refresh()}>重试</button>
        </div>
      )}
    </div>
  );
}
