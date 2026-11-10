import type { Item } from "./types";
export type Seed = {
  id: string;
  species: string;
  mystery: boolean;
  obtained: number;
};
export type Species = {
  id: string;
  name: string;
  description: string;
  color: string;
  price: number;
  days: number;
};
export type Plant = {
  id: string;
  species: string;
  mystery: boolean;
  plantedAt: number;
  caredAt: number;
  x: number;
  dead: boolean;
  growth: number;
};
export type Point = {
  id: string;
  source_id: string | null;
  source_title?: string;
  chapter: string;
  parent_id: string | null;
  title: string;
  question: string;
  answer: string;
  excerpt: string;
  locator: number;
  state: "draft" | "learning" | "mastered" | "consolidate";
  private: number;
  effective_private: number;
  stage: number;
  due: number | null;
  first_reward: number;
};
export type Message = {
  role: "user" | "assistant";
  content: string;
  time: number;
  refs?: { sourceId: string; page: number; title: string; excerpt: string }[];
};
export type Session = {
  id: string;
  source_id: string | null;
  topic: string;
  private: number;
  messages: Message[];
  updated_at: string;
};
export type Focus = {
  id: string;
  sourceId: string | null;
  topic: string;
  seconds: number;
  paused: boolean;
  startedAt: string;
};
export type Chapter = {
  page: number;
  title: string;
  text: string;
  html: string;
};
export type Person = {
  id: string;
  name: string;
  x: number;
  scene: string;
  seated?: boolean;
  focus?: { seconds: number; paused: boolean } | null;
};
export type SocialState = {
  status: string;
  error: string;
  url: string;
  code: string;
  friends: {
    id: string;
    name: string;
    online: boolean;
    focus?: { seconds: number; paused: boolean } | null;
  }[];
  requests: { id: string; name: string }[];
  invitations: { id: string; name: string; token: string }[];
  guests: Person[];
  hostId: string | null;
  room: null | {
    owner: { id: string; name: string };
    plants: Plant[];
    pose: { x: number; scene: string; seated?: boolean };
    people: Person[];
    catalog: {
      items: Pick<Item, "id" | "title" | "kind">[];
      points: Pick<
        Point,
        "id" | "title" | "question" | "answer" | "chapter" | "source_id"
      >[];
    };
    focus: Focus | null;
  };
  localAddresses: string[];
};
export type WorldState = {
  warning?: string;
  focusRewards?: any[];
  focusSummary?: { label: string; source_id: string | null; seconds: number }[];
  profile: {
    id: string;
    name: string;
    publicKey: string;
    coins: number;
    water: number;
    fertilizer: number;
    seeds: Seed[];
    plants: Plant[];
    scene: string;
  };
  points: Point[];
  sessions: Omit<Session, "messages">[];
  progress: {
    source_id: string;
    page: number;
    total: number;
    chapter: string;
    max_page: number;
  }[];
  focus: Focus | null;
  focusRecords: {
    id: string;
    source_id: string | null;
    source_title?: string;
    topic: string;
    seconds: number;
    started_at: string;
    ended_at: string;
  }[];
  rules: {
    reviewDays: number[];
    masterCoins: number;
    reviewCoins: number;
    gachaCoins: number;
    focusSeconds: number;
    focusSeedChance: number;
    readingSeedChance: number;
    deathDays: number;
  };
  species: Species[];
  social: SocialState;
  now: number;
};
export const world = <T = any>(action: string, payload?: any) =>
  window.knowledge.call<T>("world:" + action, payload);
export const timeLabel = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};
export const stateLabel = {
  draft: "待确认草稿",
  learning: "学习中",
  mastered: "已掌握",
  consolidate: "待巩固",
};
