import fs from "node:fs";
import path from "node:path";
import {
  randomUUID,
  randomInt,
  generateKeyPairSync,
  createHash,
} from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import sanitizeHtml from "sanitize-html";
import { plainText, localDay } from "./store.mjs";

export const RULES = Object.freeze({
  reviewDays: [1, 2, 4, 7, 15, 30, 60],
  masterCoins: 10,
  reviewCoins: 5,
  gachaCoins: 20,
  focusSeconds: 2700,
  focusSeedChance: 0.2,
  readingSeconds: 60,
  readingSeedChance: 0.15,
  deathDays: 7,
});
export const SPECIES = [
  {
    id: "moon",
    name: "月灯铃兰",
    description: "夜色落下时，花蕊会亮起温柔的光。",
    color: "#e9cf86",
    price: 12,
    days: 2,
  },
  {
    id: "cloud",
    name: "云朵绣球",
    description: "把路过的薄雾，收藏在蓬松的花瓣里。",
    color: "#b1cbd0",
    price: 18,
    days: 3,
  },
  {
    id: "moss",
    name: "苔绒小树",
    description: "一座慢慢生长的袖珍森林。",
    color: "#91b48b",
    price: 15,
    days: 2,
  },
  {
    id: "star",
    name: "星屑蕨",
    description: "叶尖留下了昨夜流星经过的痕迹。",
    color: "#c4b2d0",
    price: 24,
    days: 4,
  },
  {
    id: "robot",
    name: "齿轮向日葵",
    description: "古老机器的零件，在泥土里重新开了花。",
    color: "#d9a86a",
    price: 30,
    days: 5,
  },
  {
    id: "glass",
    name: "雨滴琉璃花",
    description: "下雨以后，透明的花瓣会轻轻唱歌。",
    color: "#8dc6b8",
    price: 35,
    days: 5,
  },
];
const text = (v, max = 2000) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const list = (x) => (x ? (Array.isArray(x) ? x : [x]) : []);
export function epubChapters(bytes) {
  let total = 0,
    count = 0;
  const files = unzipSync(new Uint8Array(bytes), {
    filter(f) {
      total += f.originalSize;
      count++;
      if (
        total > 80 * 1024 * 1024 ||
        count > 12000 ||
        f.originalSize > 12 * 1024 * 1024
      )
        throw Error("EPUB 解压体积超出限制");
      return true;
    },
  });
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
    removeNSPrefix: true,
  });
  const container = parser.parse(
    strFromU8(files["META-INF/container.xml"] || new Uint8Array()),
  );
  const opf = list(container.container?.rootfiles?.rootfile)[0]?.[
    "@_full-path"
  ];
  if (!opf || !files[opf]) throw Error("EPUB 缺少内容清单");
  const pkg = parser.parse(strFromU8(files[opf])).package;
  const manifest = new Map(
    list(pkg?.manifest?.item).map((i) => [i["@_id"], i]),
  );
  const chapters = [];
  for (const ref of list(pkg?.spine?.itemref)) {
    const entry = manifest.get(ref["@_idref"]);
    if (!entry) continue;
    let href;
    try {
      href = decodeURIComponent(entry["@_href"].split("#")[0]);
    } catch {
      continue;
    }
    const filename = path.posix.normalize(
      path.posix.join(path.posix.dirname(opf), href),
    );
    if (!files[filename]) continue;
    let html = strFromU8(files[filename]);
    const title = plainText(
      (html.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i) ||
        html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ||
        [])[1] || "章节 " + (chapters.length + 1),
    );
    html = html.replace(
      /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
      (_, src) => {
        let name;
        try {
          name = path.posix.normalize(
            path.posix.join(
              path.posix.dirname(filename),
              decodeURIComponent(src),
            ),
          );
        } catch {
          return "";
        }
        const data = files[name],
          ext = path.posix.extname(name).toLowerCase();
        return data &&
          data.length < 2 * 1024 * 1024 &&
          [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)
          ? `<img alt="插图" src="data:image/${ext === ".jpg" ? "jpeg" : ext.slice(1)};base64,${Buffer.from(data).toString("base64")}">`
          : "";
      },
    );
    html = sanitizeHtml(html, {
      allowedTags: [
        "p",
        "br",
        "div",
        "span",
        "h1",
        "h2",
        "h3",
        "h4",
        "strong",
        "b",
        "em",
        "i",
        "ul",
        "ol",
        "li",
        "blockquote",
        "pre",
        "code",
        "table",
        "tr",
        "td",
        "th",
        "thead",
        "tbody",
        "img",
        "sup",
        "sub",
        "hr",
      ],
      allowedAttributes: { img: ["src", "alt"] },
      allowedSchemesByTag: { img: ["data"] },
    });
    chapters.push({
      page: chapters.length + 1,
      title: text(title, 180),
      html,
      text: plainText(html),
    });
  }
  if (!chapters.length) throw Error("EPUB 没有可阅读的章节，可能受 DRM 保护");
  return chapters;
}

export class Habitat {
  constructor(
    library,
    { clock = () => Date.now(), rng = () => randomInt(1000000) / 1000000 } = {},
  ) {
    this.lib = library;
    this.clock = clock;
    this.rng = rng;
    this.epubs = new Map();
    this.lastTick = performance.now();
    this.dirty = false;
    if (!this.getState("profile")) {
      const keys = generateKeyPairSync("ed25519");
      const publicKey = keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString();
      this.setState("profile", {
        id: createHash("sha256").update(publicKey).digest("hex").slice(0, 32),
        publicKey,
        privateKey: keys.privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
        name: "林间旅人",
        coins: 0,
        water: 3,
        fertilizer: 1,
        seeds: [this.seed("moss"), this.seed(null)],
        plants: [],
        friends: [],
        scene: "garden",
        maxTime: this.clock(),
      });
    }
    const active = this.getState("focus");
    if (active && !active.paused) {
      active.paused = true;
      this.setState("focus", active);
    }
    this.active = active;
    this.lastFlush = performance.now();
  }
  getState(key) {
    const row = this.lib.rows("SELECT value FROM habitat_state WHERE key=?", [
      key,
    ])[0];
    return row ? JSON.parse(row.value) : null;
  }
  writeState(key, value) {
    this.lib.db.run("INSERT OR REPLACE INTO habitat_state VALUES(?,?)", [
      key,
      JSON.stringify(value),
    ]);
  }
  setState(key, value) {
    this.lib.transaction(() => this.writeState(key, value));
  }
  profile() {
    return this.getState("profile");
  }
  time() {
    return Math.max(this.clock(), this.profile().maxTime || 0);
  }
  seed(species) {
    return {
      id: randomUUID(),
      species: species || SPECIES[Math.floor(this.rng() * SPECIES.length)].id,
      mystery: !species,
      obtained: this.clock(),
    };
  }
  mutate(fn) {
    return this.lib.transaction(() => {
      const p = this.profile();
      p.maxTime = Math.max(p.maxTime || 0, this.clock());
      const result = fn(p, p.maxTime);
      this.writeState("profile", p);
      return result;
    });
  }
  point(id) {
    const p = this.lib.rows("SELECT * FROM learning_points WHERE id=?", [
      id,
    ])[0];
    if (!p) throw Error("知识点不存在");
    return p;
  }
  privateSource(id) {
    return id
      ? Boolean(
          this.lib.rows(
            "SELECT private FROM items WHERE id=? AND deleted_at IS NULL",
            [id],
          )[0]?.private,
        )
      : false;
  }
  snapshot() {
    const p = this.profile();
    const t = this.time();
    let changed = t - p.maxTime > 300000;
    for (const plant of p.plants)
      if (!plant.dead && t - plant.caredAt >= RULES.deathDays * 86400000) {
        plant.dead = true;
        changed = true;
      }
    if (changed) {
      p.maxTime = t;
      this.setState("profile", p);
    }
    const { privateKey, ...profile } = p;
    profile.plants = profile.plants.map((plant) => ({
      ...plant,
      growth: Math.min(
        1,
        Math.max(
          0,
          (t - plant.plantedAt + (plant.growthBoost || 0)) /
            (SPECIES.find((s) => s.id === plant.species)?.days || 3) /
            86400000,
        ),
      ),
    }));
    const points = this.lib.rows(
      "SELECT p.*,i.title source_title,CASE WHEN p.private=1 OR i.private=1 THEN 1 ELSE 0 END effective_private FROM learning_points p LEFT JOIN items i ON i.id=p.source_id ORDER BY p.updated_at DESC",
    );
    return {
      profile,
      points,
      sessions: this.lib.rows(
        "SELECT id,source_id,topic,private,updated_at FROM learning_sessions ORDER BY updated_at DESC",
      ),
      progress: this.lib.rows("SELECT * FROM reading_progress"),
      focus: this.active,
      focusRecords: this.lib.rows(
        "SELECT f.*,i.title source_title FROM focus_records f LEFT JOIN items i ON i.id=f.source_id ORDER BY ended_at DESC LIMIT 500",
      ),
      focusSummary: this.lib.rows(
        "SELECT COALESCE(i.title,f.topic) label,f.source_id,SUM(f.seconds) seconds FROM focus_records f LEFT JOIN items i ON i.id=f.source_id GROUP BY COALESCE(f.source_id,f.topic) ORDER BY seconds DESC LIMIT 20",
      ),
      rules: RULES,
      species: SPECIES,
      now: t,
    };
  }
  session(payload) {
    if (payload.id) {
      const s = this.lib.rows("SELECT * FROM learning_sessions WHERE id=?", [
        payload.id,
      ])[0];
      if (!s) throw Error("学习对话不存在");
      return { ...s, messages: JSON.parse(s.messages) };
    }
    if (payload.sourceId) this.lib.get(payload.sourceId);
    const s = {
      id: randomUUID(),
      source_id: payload.sourceId || null,
      topic: text(payload.topic || "自由学习", 200),
      private: this.privateSource(payload.sourceId) ? 1 : 0,
      messages: [],
      updated_at: new Date(this.time()).toISOString(),
    };
    this.lib.transaction(() =>
      this.lib.db.run("INSERT INTO learning_sessions VALUES(?,?,?,?,?,?)", [
        s.id,
        s.source_id,
        s.topic,
        s.private,
        "[]",
        s.updated_at,
      ]),
    );
    return s;
  }
  saveSession(s, messages) {
    this.lib.transaction(() =>
      this.lib.db.run(
        "UPDATE learning_sessions SET messages=?,updated_at=? WHERE id=?",
        [JSON.stringify(messages), new Date(this.time()).toISOString(), s.id],
      ),
    );
  }
  confirmPoint(payload) {
    const p = this.point(payload.id);
    const title = text(payload.title ?? p.title, 200),
      question = text(payload.question ?? p.question, 2000),
      answer = text(payload.answer ?? p.answer, 12000);
    if (!title || !question || !answer)
      throw Error("请填写标题、复习问题和参考要点");
    this.lib.transaction(() =>
      this.lib.db.run(
        "UPDATE learning_points SET title=?,question=?,answer=?,state=?,updated_at=? WHERE id=?",
        [
          title,
          question,
          answer,
          p.state === "draft" ? "learning" : p.state,
          new Date(this.time()).toISOString(),
          p.id,
        ],
      ),
    );
    return this.point(p.id);
  }
  addPoints(points, { sourceId = null, chapter = "自由学习", page = 1 } = {}) {
    if (!Array.isArray(points) || !points.length)
      throw Error("老师没有生成知识点，请补充学习内容后重试");
    const ids = [];
    this.lib.transaction(() => {
      for (const [index, p] of points.slice(0, 25).entries()) {
        const title = text(p.title, 200),
          question = text(p.question, 2000),
          answer = text(p.answer, 12000);
        if (!title || !question || !answer) continue;
        const duplicate = this.lib.rows(
          "SELECT id FROM learning_points WHERE source_id IS ? AND chapter=? AND title=?",
          [sourceId, chapter, title],
        )[0];
        if (duplicate) {
          ids[index] = duplicate.id;
          continue;
        }
        const id = randomUUID();
        ids[index] = id;
        const parent =
          Number.isInteger(p.parent) && p.parent >= 0 && p.parent < index
            ? ids[p.parent] || null
            : null;
        this.lib.db.run(
          "INSERT INTO learning_points(id,source_id,chapter,parent_id,title,question,answer,excerpt,locator,state,private,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            id,
            sourceId,
            text(chapter, 200),
            parent,
            title,
            question,
            answer,
            text(p.excerpt, 3000),
            Math.max(1, Math.floor(Number(page) || 1)),
            "draft",
            this.privateSource(sourceId) ? 1 : 0,
            new Date(this.time()).toISOString(),
          ],
        );
      }
    });
    return [...new Set(ids.filter(Boolean))];
  }
  assess(id, result) {
    this.point(id);
    if (
      typeof result.mastered !== "boolean" ||
      !Number.isFinite(result.score) ||
      result.score < 1 ||
      result.score > 100 ||
      typeof result.feedback !== "string"
    )
      throw Error("老师返回的评估格式无效，请重试");
    return this.mutate((profile, t) => {
      const p = this.point(id);
      if (p.state === "draft") throw Error("请先确认知识点草稿");
      let reward = null,
        stage = p.stage,
        due = p.due,
        first = p.first_reward;
      if (result.mastered) {
        if (!first) {
          const seed = this.seed(null);
          profile.seeds.push(seed);
          profile.coins += RULES.masterCoins;
          first = 1;
          stage = 0;
          due = t + RULES.reviewDays[0] * 86400000;
          reward = {
            seed,
            coins: RULES.masterCoins,
            label: "首次掌握 · 神秘种子",
          };
        } else if (due !== null && t >= due) {
          profile.water++;
          profile.fertilizer++;
          profile.coins += RULES.reviewCoins;
          stage = Math.min(stage + 1, RULES.reviewDays.length - 1);
          due = t + RULES.reviewDays[stage] * 86400000;
          reward = {
            water: 1,
            fertilizer: 1,
            coins: RULES.reviewCoins,
            label: "到期复习通过",
          };
        }
      } else if (first) {
        stage = 0;
        due = due ?? t + RULES.reviewDays[0] * 86400000;
      }
      this.lib.db.run(
        "UPDATE learning_points SET state=?,stage=?,due=?,first_reward=?,updated_at=? WHERE id=?",
        [
          result.mastered ? "mastered" : first ? "consolidate" : "learning",
          stage,
          due,
          first,
          new Date(t).toISOString(),
          id,
        ],
      );
      return {
        ...result,
        score: Math.round(result.score),
        feedback: text(result.feedback, 5000),
        reward,
      };
    });
  }
  setPrivacy({ type, id, private: privateValue }) {
    const value = privateValue ? 1 : 0;
    if (type === "item") this.lib.get(id);
    else if (type === "point") {
      const p = this.point(id);
      if (!value && this.privateSource(p.source_id))
        throw Error("原资料为私密，衍生知识点不能公开");
    } else throw Error("不支持的隐私对象");
    this.lib.transaction(() => {
      if (type === "item") {
        this.lib.db.run("UPDATE items SET private=? WHERE id=?", [value, id]);
        if (value) {
          this.lib.db.run(
            "UPDATE learning_points SET private=1 WHERE source_id=?",
            [id],
          );
          this.lib.db.run(
            "UPDATE learning_sessions SET private=1 WHERE source_id=?",
            [id],
          );
        }
      } else
        this.lib.db.run("UPDATE learning_points SET private=? WHERE id=?", [
          value,
          id,
        ]);
    });
    return true;
  }
  chapters(id) {
    const item = this.lib.get(id);
    if (item.deleted_at) throw Error("资料已在回收站");
    if (item.kind === "epub") {
      const key = item.asset;
      if (!this.epubs.has(key)) {
        if (this.epubs.size > 5) this.epubs.clear();
        this.epubs.set(
          key,
          epubChapters(fs.readFileSync(this.lib.assetPath(key))),
        );
      }
      return this.epubs.get(key);
    }
    if (item.kind === "pdf") {
      const outline = (this.getState("pdf-outline:" + id) || []).sort(
        (a, b) => a.page - b.page,
      );
      return this.lib
        .rows("SELECT page,text FROM pdf_pages WHERE item_id=? ORDER BY page", [
          id,
        ])
        .map((p) => {
          const heading = outline.filter((o) => o.page <= p.page).at(-1);
          return {
            ...p,
            title: heading?.title || "第 " + p.page + " 页",
            level: heading?.level || 0,
            heading: !heading || heading.page === p.page,
            html: "<p>" + escape(p.text).replace(/\n/g, "</p><p>") + "</p>",
          };
        });
    }
    if (item.kind === "word") return [];
    return [{ page: 1, title: item.title, text: item.plain, html: item.html }];
  }
  progress(payload) {
    this.lib.get(payload.sourceId);
    const page = Math.max(1, Math.floor(Number(payload.page) || 1)),
      total = Math.max(page, Math.floor(Number(payload.total) || page));
    this.lib.transaction(() =>
      this.lib.db.run(
        "INSERT INTO reading_progress VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET page=excluded.page,total=excluded.total,chapter=excluded.chapter,max_page=MAX(max_page,excluded.page)",
        [payload.sourceId, page, total, text(payload.chapter, 200), page],
      ),
    );
    return true;
  }
  readingPulse(sourceId) {
    const t = this.time(),
      key = "reading:" + sourceId;
    this.lib.get(sourceId);
    const r = this.getState(key) || { last: t, seconds: 0, day: "" };
    r.seconds += Math.min(35, Math.max(0, (t - r.last) / 1000));
    r.last = t;
    let seed = null;
    const day = localDay(new Date(t));
    this.mutate((p) => {
      if (r.seconds >= RULES.readingSeconds && r.day !== day) {
        r.day = day;
        if (this.rng() < RULES.readingSeedChance) {
          seed = this.seed(null);
          p.seeds.push(seed);
        }
      }
      this.writeState(key, r);
    });
    return seed;
  }
  startFocus({ topic, sourceId }) {
    const existing = this.active;
    if (existing) throw Error("已有专注记录，请先结束");
    if (sourceId) this.lib.get(sourceId);
    const active = {
      id: randomUUID(),
      sourceId: sourceId || null,
      topic: text(topic || "自由专注", 200),
      seconds: 0,
      rewardCycles: 0,
      paused: false,
      startedAt: new Date(this.time()).toISOString(),
    };
    this.lastTick = performance.now();
    this.setState("focus", active);
    this.active = active;
    return active;
  }
  tick(force = false) {
    const active = this.active;
    const tick = performance.now(),
      delta = Math.min(3, Math.max(0, (tick - this.lastTick) / 1000));
    this.lastTick = tick;
    if (!active || active.paused) return null;
    active.seconds += delta;
    const cycles = Math.floor(active.seconds / RULES.focusSeconds);
    let reward = null;
    if (
      !force &&
      cycles <= active.rewardCycles &&
      tick - this.lastFlush < 15000
    )
      return null;
    const beforeCycles = active.rewardCycles;
    try {
      this.mutate((p) => {
        while (active.rewardCycles < cycles) {
          active.rewardCycles++;
          if (this.rng() < RULES.focusSeedChance) {
            const seed = this.seed(null);
            p.seeds.push(seed);
            reward = seed;
            const queue = this.getState("reward_queue") || [];
            queue.push({
              eventId: seed.id,
              seed,
              label: "45 分钟专注 · 森林的回礼",
            });
            this.writeState("reward_queue", queue);
          }
        }
        this.writeState("focus", active);
      });
    } catch (e) {
      active.rewardCycles = beforeCycles;
      throw e;
    }
    this.lastFlush = tick;
    return reward;
  }
  focusControl(action) {
    this.tick(true);
    const a = this.active;
    if (!a) throw Error("没有进行中的专注");
    if (action === "stop") {
      this.lib.transaction(() => {
        if (a.seconds >= 1)
          this.lib.db.run("INSERT INTO focus_records VALUES(?,?,?,?,?,?)", [
            a.id,
            a.sourceId,
            a.topic,
            Math.floor(a.seconds),
            a.startedAt,
            new Date(this.time()).toISOString(),
          ]);
        this.writeState("focus", null);
      });
      this.active = null;
      return null;
    }
    if (!["pause", "resume"].includes(action)) throw Error("无效计时操作");
    a.paused = action === "pause";
    this.lastTick = performance.now();
    this.setState("focus", a);
    return a;
  }
  garden(action, payload = {}) {
    return this.mutate((p, t) => {
      for (const plant of p.plants)
        if (t - plant.caredAt >= RULES.deathDays * 86400000) plant.dead = true;
      if (action === "buy" || action === "gacha") {
        const species = SPECIES.find((s) => s.id === payload.species),
          price = action === "gacha" ? RULES.gachaCoins : species?.price;
        if (!price || p.coins < price)
          throw Error("金币不足，学习和到期复习可以获得金币");
        p.coins -= price;
        const seed = this.seed(action === "gacha" ? null : species.id);
        p.seeds.push(seed);
        return { seed, label: action === "gacha" ? "扭蛋种子" : "购入种子" };
      }
      if (action === "plant") {
        const seed = p.seeds.find((s) => s.id === payload.id);
        if (!seed) throw Error("种子已使用");
        const x = Number(payload.x);
        if (!Number.isFinite(x) || x < 8 || x > 94)
          throw Error("请选择花园内的位置");
        if (p.plants.some((plant) => Math.abs(plant.x - x) < 4))
          throw Error("这里已经有植物，请换个位置");
        p.seeds = p.seeds.filter((s) => s.id !== seed.id);
        const plant = {
          id: randomUUID(),
          species: seed.species,
          mystery: seed.mystery,
          plantedAt: t,
          caredAt: t,
          wateredAt: 0,
          fertilizedAt: 0,
          prunedAt: 0,
          x,
          dead: false,
        };
        p.plants.push(plant);
        return plant;
      }
      if (action === "rename") {
        p.name = text(payload.name, 24) || "林间旅人";
        return true;
      }
      if (action === "scene") {
        if (!["garden", "home"].includes(payload.scene))
          throw Error("无效场景");
        p.scene = payload.scene;
        return true;
      }
      const plant = p.plants.find((v) => v.id === payload.id);
      if (!plant) throw Error("植物不存在");
      if (action === "remove") {
        if (!plant.dead) throw Error("只有枯死的植物可以移除");
        p.plants = p.plants.filter((v) => v.id !== plant.id);
        return true;
      }
      if (plant.dead) throw Error("植物已永久枯死，需要重新种植");
      if (action === "move") {
        const x = Number(payload.x);
        if (
          !Number.isFinite(x) ||
          x < 8 ||
          x > 94 ||
          p.plants.some((v) => v.id !== plant.id && Math.abs(v.x - x) < 4)
        )
          throw Error("此位置不可摆放");
        plant.x = x;
        return true;
      }
      const map = {
        water: ["water", "wateredAt"],
        fertilize: ["fertilizer", "fertilizedAt"],
        prune: [null, "prunedAt"],
      };
      const rule = map[action];
      if (!rule) throw Error("无效照料操作");
      if (t - (plant[rule[1]] || 0) < 12 * 3600000)
        throw Error("这项照料今天已经完成，稍后再来");
      if (rule[0]) {
        if (p[rule[0]] < 1) throw Error("资源不足，完成到期复习可获得水和肥料");
        p[rule[0]]--;
      }
      plant[rule[1]] = t;
      plant.caredAt = t;
      if (action === "fertilize")
        plant.growthBoost = (plant.growthBoost || 0) + 12 * 3600000;
      return true;
    });
  }
  sharedCatalog({ query = "", offset = 0 } = {}) {
    const q = text(query, 200).toLowerCase(),
      start = Math.max(0, Math.floor(Number(offset) || 0));
    const items = this.lib.rows(
      "SELECT id,title,kind,folder_id FROM items WHERE private=0 AND deleted_at IS NULL AND instr(lower(title),?)>0 ORDER BY title,id LIMIT 100 OFFSET ?",
      [q, start],
    );
    const where =
      "p.private=0 AND COALESCE(i.private,0)=0 AND i.deleted_at IS NULL AND p.state<>'draft' AND (instr(lower(p.title),?)>0 OR instr(lower(p.question),?)>0)";
    const points = this.lib.rows(
      `SELECT p.id,p.title,substr(p.question,1,500) question,'' answer,p.chapter,p.source_id FROM learning_points p LEFT JOIN items i ON i.id=p.source_id WHERE ${where} ORDER BY p.title,p.id LIMIT 100 OFFSET ?`,
      [q, q, start],
    );
    return {
      items,
      points,
      itemCount: this.lib.rows(
        "SELECT COUNT(*) n FROM items WHERE private=0 AND deleted_at IS NULL AND instr(lower(title),?)>0",
        [q],
      )[0].n,
      pointCount: this.lib.rows(
        `SELECT COUNT(*) n FROM learning_points p LEFT JOIN items i ON i.id=p.source_id WHERE ${where}`,
        [q, q],
      )[0].n,
    };
  }
  sharedPoint(id) {
    const p = this.point(id);
    const source = p.source_id
      ? this.lib.rows("SELECT private,deleted_at FROM items WHERE id=?", [
          p.source_id,
        ])[0]
      : null;
    if (
      p.private ||
      source?.private ||
      source?.deleted_at ||
      p.state === "draft"
    )
      throw Error("该知识点未共享");
    return {
      id: p.id,
      title: p.title,
      question: p.question,
      answer: p.answer,
      chapter: p.chapter,
    };
  }
  sharedDocument(id, page = 1) {
    const item = this.lib.get(id);
    if (item.private || item.deleted_at) throw Error("该资料未共享或已移除");
    if (item.kind === "note")
      return { title: item.title, kind: "note", chunked: true };
    if (item.kind === "word")
      return {
        title: item.title,
        kind: "word",
        text: "Word 资料以原文件存放，访客阅读请向主人索取文件。",
      };
    const chapters = this.chapters(id),
      chapter =
        chapters[Math.max(0, Math.min(chapters.length - 1, Number(page) - 1))];
    return {
      title: item.title,
      kind: item.kind,
      total: chapters.length,
      page: chapter?.page || 1,
      html: chapter?.html || "",
      text: chapter?.text || "正在索引或没有可提取的文字",
    };
  }
}
