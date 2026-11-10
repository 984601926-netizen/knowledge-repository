import { useEffect, useRef, useState } from "react";
import {
  DoorOpen,
  BookOpen,
  Armchair,
  ShoppingBag,
  Gift,
  Hand,
} from "lucide-react";
import type { WorldState, Plant, Species } from "./worldTypes";
import { world, timeLabel } from "./worldTypes";

export function Botanical({
  species,
  growth = 1,
  dead = false,
}: {
  species: Species;
  growth?: number;
  dead?: boolean;
}) {
  const petals = species.id === "star" ? 5 : species.id === "robot" ? 12 : 7;
  return (
    <svg
      viewBox="0 0 120 160"
      className={"botanical " + (dead ? "dead" : "")}
      role="img"
      aria-label={
        dead ? "枯萎的植物" : growth < 0.4 ? "新生幼苗" : species.name
      }
    >
      <ellipse cx="60" cy="150" rx="29" ry="5" fill="#172e2428" />
      <path
        d="M38 127L43 149Q60 158 77 149L82 127Z"
        fill="#ac8261"
        stroke="#6b6148"
        strokeWidth="2"
      />
      <ellipse cx="60" cy="127" rx="23" ry="5" fill="#635543" />
      <g
        transform={`translate(60 127) scale(${0.35 + growth * 0.65}) translate(-60 -127)`}
        stroke="#405c41"
        strokeWidth="2"
      >
        <path
          d={dead ? "M60 127Q52 78 81 67Q96 63 94 82" : "M60 127Q49 75 62 40"}
          strokeWidth="4"
          fill="none"
        />
        <path
          d="M58 106Q18 103 27 78Q59 77 58 106M58 83Q92 87 95 62Q69 62 58 83"
          fill={dead ? "#8c7c51" : "#70946a"}
        />
        {growth < 0.4 ? (
          <path d="M54 77Q38 60 46 47Q65 53 62 77" fill="#a3b98a" />
        ) : species.id === "moss" ? (
          <>
            <ellipse cx="59" cy="46" rx="32" ry="35" fill="#7f9a6e" />
            <circle cx="42" cy="32" r="15" fill="#9cad82" />
            <circle cx="75" cy="32" r="17" fill="#94aa7e" />
          </>
        ) : (
          <g transform={dead ? "translate(32 38) rotate(42 60 40)" : ""}>
            {Array.from({ length: petals }, (_, i) => (
              <ellipse
                key={i}
                cx="62"
                cy="25"
                rx={species.id === "cloud" ? 15 : 9}
                ry="18"
                transform={`rotate(${(i * 360) / petals} 62 42)`}
                fill={dead ? "#a18f69" : species.color}
                stroke="#777c5a"
                strokeWidth="1.2"
              />
            ))}
            <circle cx="62" cy="42" r="11" fill="#d7b66d" stroke="#817750" />
            <circle cx="59" cy="38" r="3" fill="#fff8d6" opacity=".6" />
          </g>
        )}
      </g>
    </svg>
  );
}
export default function GardenScene({
  state,
  scene,
  onScene,
  onInteract,
  onPlant,
  placement,
  onPlace,
}: {
  state: WorldState;
  scene: string;
  onScene: (scene: string) => void;
  onInteract: (kind: string) => void;
  onPlant: (plant: Plant) => void;
  placement: boolean;
  onPlace: (x: number) => void;
}) {
  const [x, setX] = useState(50),
    [walking, setWalking] = useState(false),
    [direction, setDirection] = useState(1);
  const pos = useRef(50),
    target = useRef<number | null>(null),
    pending = useRef<string | null>(null),
    keys = useRef(new Set<string>()),
    stage = useRef<HTMLDivElement>(null),
    actionRef = useRef(onInteract);
  actionRef.current = onInteract;
  const spots =
    scene === "home"
      ? [
          {
            id: "library",
            x: 19,
            label: "书架",
            detail: "管理学习资料",
            icon: BookOpen,
          },
          {
            id: "study",
            x: 74,
            label: "书桌",
            detail: "阅读 · 与老师交流",
            icon: Armchair,
          },
          {
            id: "garden",
            x: 49,
            label: "走出小屋",
            detail: "回到植物园",
            icon: DoorOpen,
          },
        ]
      : [
          {
            id: "home",
            x: 14,
            label: "林间小屋",
            detail: "进入书房",
            icon: DoorOpen,
          },
          {
            id: "shop",
            x: 84,
            label: "种子商店",
            detail: "挑选下一份惊喜",
            icon: ShoppingBag,
          },
          {
            id: "gacha",
            x: 69,
            label: "森林扭蛋机",
            detail: "转动未知的种子",
            icon: Gift,
          },
        ];
  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  const activate = (id: string) => {
    if (id === "garden" || id === "home") onScene(id);
    else actionRef.current(id);
  };
  const activateRef = useRef(activate);
  activateRef.current = activate;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true],[role=dialog]",
        )
      )
        return;
      if (["ArrowLeft", "ArrowRight", "a", "d", "A", "D"].includes(e.key)) {
        e.preventDefault();
        keys.current.add(e.key.toLowerCase());
        target.current = null;
        pending.current = null;
      }
      if (e.key.toLowerCase() === "e") {
        const spot = spotsRef.current.find(
          (s) => Math.abs(s.x - pos.current) < 9,
        );
        if (spot) activateRef.current(spot.id);
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    let frame = 0,
      last = performance.now(),
      published = 0;
    const tick = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      let step = 0;
      if (keys.current.has("arrowleft") || keys.current.has("a"))
        step = -dt * 0.024;
      if (keys.current.has("arrowright") || keys.current.has("d"))
        step = dt * 0.024;
      if (target.current !== null) {
        const diff = target.current - pos.current;
        if (Math.abs(diff) < 0.6) {
          target.current = null;
          const id = pending.current;
          pending.current = null;
          if (id) activateRef.current(id);
        } else step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.024);
      }
      if (step) {
        pos.current = Math.max(3, Math.min(97, pos.current + step));
        setX(pos.current);
        setDirection(Math.sign(step));
      }
      setWalking(Boolean(step));
      if (now - published > 800 && step) {
        published = now;
        void world("social-pose", { x: pos.current, scene }).catch(() => {});
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [scene]);
  const guest = state.social.room;
  const plants = guest?.plants || state.profile.plants;
  const people = guest
    ? [
        {
          id: guest.owner.id,
          name: guest.owner.name,
          x: guest.pose.x,
          scene: guest.pose.scene,
          seated: guest.pose.seated,
          focus: guest.focus,
        },
        ...guest.people.filter((p) => p.id !== state.profile.id),
      ]
    : state.social.guests;
  const go = (id: string, value: number) => {
    target.current = value;
    pending.current = id;
  };
  return (
    <section
      className={"forest-scene " + scene + (placement ? " placing" : "")}
      ref={stage}
      aria-label={scene === "home" ? "林间小屋" : "植物园"}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const r = stage.current!.getBoundingClientRect(),
          value = Math.max(
            8,
            Math.min(94, ((e.clientX - r.left) / r.width) * 100),
          );
        if (placement) {
          onPlace(value);
          return;
        }
        target.current = value;
        pending.current = null;
      }}
    >
      <div className="scene-art" />
      <div className="scene-haze" />
      <div className="motes">
        {Array.from({ length: 12 }, (_, i) => (
          <i
            key={i}
            style={{
              left: i * 8 + "%",
              animationDelay: i * -0.8 + "s",
              top: 15 + (i % 4) * 16 + "%",
            }}
          />
        ))}
      </div>
      <div className="scene-caption">
        <span>THE QUIET GARDEN</span>
        <h1>
          {guest
            ? guest.owner.name + "的家园"
            : scene === "home"
              ? "把好奇，留在这里。"
              : "让知识，慢慢生长。"}
        </h1>
        <p>
          {scene === "home"
            ? "一本书，一束光，一个值得想明白的问题。"
            : "每一次理解，都将在这片森林留下生命。"}
        </p>
      </div>
      {spots.map((s) => (
        <button
          className={"scene-spot spot-" + s.id}
          style={{ left: s.x + "%" }}
          key={s.id}
          onClick={() => go(s.id, s.x)}
        >
          <s.icon size={21} />
          <span>
            <strong>{s.label}</strong>
            <small>{s.detail}</small>
          </span>
          <kbd>{Math.abs(x - s.x) < 9 ? "E" : "走近"}</kbd>
        </button>
      ))}
      {scene === "garden" &&
        plants.map((p) => (
          <button
            key={p.id}
            className="planted"
            style={{ left: p.x + "%" }}
            onClick={() => {
              if (!guest) onPlant(p);
            }}
            title={
              p.dead
                ? "已永久枯萎"
                : p.mystery && p.growth < 0.4
                  ? "神秘幼苗"
                  : state.species.find((s) => s.id === p.species)?.name
            }
          >
            <Botanical
              species={
                state.species.find((s) => s.id === p.species) ||
                state.species[0]
              }
              growth={p.growth}
              dead={p.dead}
            />
            {!p.dead && state.now - p.caredAt > 86400000 && (
              <span className="thirst">需要照料</span>
            )}
          </button>
        ))}
      {people
        .filter((p) => p.scene === scene)
        .map((p) => (
          <div className="other-person" key={p.id} style={{ left: p.x + "%" }}>
            <span>
              {p.name}
              {p.focus && !p.focus.paused
                ? " · " + timeLabel(p.focus.seconds)
                : ""}
            </span>
            <img
              src={
                scene === "home" && (p.seated || (p.focus && !p.focus.paused))
                  ? "./art/seated.png"
                  : "./art/traveler.png"
              }
              alt="好友角色"
            />
          </div>
        ))}
      <div
        className={"traveler " + (walking ? "walking" : "")}
        style={{ left: x + "%" }}
      >
        <span>{state.profile.name}</span>
        <img
          src={
            scene === "home" && state.focus && !state.focus.paused && !walking
              ? "./art/seated.png"
              : "./art/traveler.png"
          }
          alt="我的角色"
          style={{ transform: `scaleX(${direction})` }}
        />
      </div>
      <div className="scene-floor-help">
        <Hand size={15} />
        {placement
          ? "点击花园地面，选择摆放位置"
          : "点击地面行走 · ← → / A D 移动 · E 交互"}
        <span>
          {guest
            ? "好友家园 · 一起安静学习"
            : scene === "home"
              ? "书架收纳资料，书桌开始学习"
              : "森林的时间，和现实一起流动"}
        </span>
      </div>
    </section>
  );
}
