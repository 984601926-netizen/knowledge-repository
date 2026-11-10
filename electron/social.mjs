import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, randomUUID, sign, verify, createHash } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import sanitizeHtml from "sanitize-html";

const validId = (id) => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
const send = (socket, data) => {
  if (socket?.bufferedAmount > 8 * 1024 * 1024) {
    socket.close(1009, "slow connection");
    return;
  }
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
};
function sharedHtml(html) {
  return sanitizeHtml(String(html), {
    allowedTags: [
      "p",
      "div",
      "span",
      "br",
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
      "sup",
      "sub",
      "hr",
      "img",
    ],
    allowedAttributes: { img: ["data-asset", "alt"] },
    transformTags: {
      img: (_, attrs) => {
        const match = String(attrs.src || "").match(
          /^kbasset:\/\/asset\/([a-f0-9-]{36}\.(?:png|jpg|jpeg|gif|webp))$/,
        );
        return {
          tagName: "img",
          attribs: match
            ? {
                "data-asset": match[1],
                alt: String(attrs.alt || "插图").slice(0, 200),
              }
            : { alt: "插图不可用" },
        };
      },
    },
  });
}
export function createRelay({ port = 47831, host = "0.0.0.0" } = {}) {
  const server = new WebSocketServer({
    port,
    host,
    maxPayload: 600 * 1024,
    perMessageDeflate: false,
  });
  const clients = new Map();
  const presence = () => {
    for (const client of clients.values())
      send(client, {
        type: "presence",
        peers: [...clients.entries()]
          .filter(([id]) => client.watch?.includes(id))
          .map(([id, s]) => ({ id, name: s.name, focus: s.focus || null })),
      });
  };
  server.on("connection", (socket, request) => {
    if (request.headers.origin) {
      socket.close(1008, "native clients only");
      return;
    }
    const nonce = randomBytes(32).toString("hex");
    socket.alive = true;
    socket.count = 0;
    socket.window = Date.now();
    send(socket, { type: "challenge", nonce });
    const timeout = setTimeout(() => {
      if (!socket.identity) socket.close(1008, "authentication timeout");
    }, 10000);
    timeout.unref();
    socket.on("pong", () => (socket.alive = true));
    socket.on("message", (bytes) => {
      try {
        if (Date.now() - socket.window > 1000) {
          socket.count = 0;
          socket.window = Date.now();
        }
        if (++socket.count > 400) throw Error("rate limit");
        const p = JSON.parse(bytes.toString());
        if (!socket.identity) {
          if (
            p.type !== "authenticate" ||
            typeof p.publicKey !== "string" ||
            p.publicKey.length > 500 ||
            typeof p.signature !== "string"
          )
            throw Error("auth");
          const id = createHash("sha256")
            .update(p.publicKey)
            .digest("hex")
            .slice(0, 32);
          if (
            !verify(
              null,
              Buffer.from("shizhi-relay:v1:" + nonce),
              p.publicKey,
              Buffer.from(p.signature, "base64"),
            )
          )
            throw Error("auth");
          const old = clients.get(id);
          if (old) old.close(1008, "same identity connected elsewhere");
          socket.identity = id;
          socket.name = String(p.name || "旅人").slice(0, 24);
          socket.watch = Array.isArray(p.watch)
            ? p.watch.filter(validId).slice(0, 200)
            : [];
          clients.set(id, socket);
          clearTimeout(timeout);
          send(socket, { type: "ready", id });
          presence();
          return;
        }
        if (p.type === "watch") {
          socket.watch = Array.isArray(p.ids)
            ? p.ids.filter(validId).slice(0, 200)
            : [];
          presence();
          return;
        }
        if (p.type === "status") {
          socket.focus = p.focus
            ? {
                seconds: Math.max(
                  0,
                  Math.min(31536000, Number(p.focus.seconds) || 0),
                ),
                paused: !!p.focus.paused,
              }
            : null;
          socket.name = String(p.name || socket.name).slice(0, 24);
          presence();
          return;
        }
        if (
          p.type !== "route" ||
          !validId(p.to) ||
          typeof p.data !== "object" ||
          !p.data
        )
          throw Error("invalid route");
        const target = clients.get(p.to);
        if (!target) {
          send(socket, { type: "offline", id: p.to, rid: p.data.rid });
          return;
        }
        send(target, {
          type: "peer",
          from: socket.identity,
          name: socket.name,
          data: p.data,
        });
      } catch {
        socket.close(1008, "invalid packet");
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timeout);
      if (clients.get(socket.identity) === socket) {
        clients.delete(socket.identity);
        presence();
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const s of server.clients) {
      if (!s.alive) {
        s.terminate();
        continue;
      }
      s.alive = false;
      s.ping();
    }
  }, 20000);
  heartbeat.unref();
  server.on("close", () => clearInterval(heartbeat));
  server.on("error", () => {});
  return server;
}

export class Social {
  constructor(habitat) {
    this.h = habitat;
    this.status = "offline";
    this.error = "";
    this.peers = [];
    this.requests = [];
    this.invitations = [];
    this.invited = new Map();
    this.guests = new Map();
    this.pending = new Map();
    this.hostId = null;
    this.room = null;
    this.socket = null;
    this.localServer = null;
    this.url = habitat.getState("relay") || "";
    this.closed = false;
    this.pose = { x: 50, scene: "garden" };
    if (this.url) this.connect(this.url);
  }
  identity() {
    return this.h.profile();
  }
  friends() {
    return this.identity().friends || [];
  }
  isFriend(id) {
    return this.friends().some((f) => f.id === id);
  }
  addFriend(id, name) {
    this.h.mutate((p) => {
      if (!p.friends.some((f) => f.id === id))
        p.friends.push({ id, name: String(name || "旅人").slice(0, 24) });
    });
    this.watch();
  }
  watch() {
    send(this.socket, { type: "watch", ids: this.friends().map((f) => f.id) });
  }
  snapshot() {
    return {
      status: this.status,
      error: this.error,
      url: this.url,
      code: this.url
        ? "sz1:" +
          Buffer.from(
            JSON.stringify({
              id: this.identity().id,
              url: this.url,
              name: this.identity().name,
            }),
          ).toString("base64url")
        : "",
      friends: this.friends().map((f) => ({
        ...f,
        name: this.peers.find((p) => p.id === f.id)?.name || f.name,
        focus: this.peers.find((p) => p.id === f.id)?.focus || null,
        online: this.peers.some((p) => p.id === f.id),
      })),
      requests: this.requests,
      invitations: this.invitations,
      guests: [...this.guests.values()],
      hostId: this.hostId,
      room: this.room,
      localAddresses: Object.values(os.networkInterfaces())
        .flat()
        .filter((n) => n && n.family === "IPv4" && !n.internal)
        .map((n) => "ws://" + n.address + ":47831"),
    };
  }
  connect(raw) {
    const url = new URL(String(raw));
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw Error("请输入有效的 ws:// 或 wss:// 自习服务地址");
    this.disconnect();
    this.closed = false;
    this.url = url.href;
    this.h.setState("relay", this.url);
    this.status = "connecting";
    this.error = "";
    const socket = (this.socket = new WebSocket(this.url, {
      maxPayload: 600 * 1024,
      handshakeTimeout: 10000,
    }));
    socket.on("message", (bytes) => {
      if (this.socket !== socket) return;
      try {
        void this.packet(JSON.parse(bytes.toString())).catch(
          (e) => (this.error = e.message),
        );
      } catch {
        this.error = "收到无效的自习服务消息";
      }
    });
    socket.on("error", () => {
      if (this.socket === socket)
        this.error = "无法连接自习服务，请检查地址、网络或服务是否启动";
    });
    socket.on("close", (code) => {
      if (this.socket !== socket) return;
      this.status = "offline";
      this.peers = [];
      this.hostId = null;
      this.room = null;
      this.guests.clear();
      for (const p of this.pending.values()) p.reject(Error("自习服务已断开"));
      this.pending.clear();
      if (code === 1008) {
        this.error =
          "身份验证被拒绝或同一身份已在其他设备连接，请关闭重复实例后手动重连";
        return;
      }
      if (!this.closed) {
        this.retry = setTimeout(() => {
          if (!this.closed) this.connect(this.url);
        }, 5000);
        this.retry.unref();
      }
    });
    return true;
  }
  disconnect() {
    this.closed = true;
    clearTimeout(this.retry);
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      s.close();
    }
    this.status = "offline";
    this.peers = [];
    this.hostId = null;
    this.room = null;
    this.guests.clear();
    this.invited.clear();
    for (const p of this.pending.values()) p.reject(Error("连接已关闭"));
    this.pending.clear();
  }
  async local() {
    if (!this.localServer) {
      const server = createRelay();
      await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      this.localServer = server;
    }
    this.connect(this.snapshot().localAddresses[0] || "ws://127.0.0.1:47831");
    return this.snapshot();
  }
  route(to, data) {
    if (this.status !== "online") throw Error("请先连接自习服务");
    send(this.socket, { type: "route", to, data });
  }
  async request(to, data) {
    const rid = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(Error("好友没有响应，请确认仍在线并已邀请你"));
      }, 15000);
      timer.unref();
      this.pending.set(rid, {
        from: to,
        resolve: (x) => {
          clearTimeout(timer);
          resolve(x);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.route(to, { ...data, rid });
      } catch (e) {
        this.pending.delete(rid);
        clearTimeout(timer);
        reject(e);
      }
    });
  }
  publicRoom() {
    const p = this.h.snapshot().profile,
      a = this.h.active;
    return {
      owner: { id: p.id, name: p.name },
      plants: p.plants,
      pose: this.pose,
      people: [...this.guests.values()],
      catalog: this.h.sharedCatalog(),
      focus: a
        ? { topic: "专注中", seconds: Math.floor(a.seconds), paused: a.paused }
        : null,
    };
  }
  publish() {
    if (this.status !== "online") return;
    const a = this.h.active;
    send(this.socket, {
      type: "status",
      name: this.identity().name,
      focus: a ? { seconds: Math.floor(a.seconds), paused: a.paused } : null,
    });
    if (this.guests.size) {
      const room = this.publicRoom();
      for (const id of this.guests.keys())
        this.route(id, { type: "room", room });
    }
    if (this.hostId)
      this.route(this.hostId, {
        type: "pose",
        ...this.pose,
        focus: a ? { seconds: Math.floor(a.seconds), paused: a.paused } : null,
      });
  }
  async packet(p) {
    if (p.type === "challenge") {
      const profile = this.identity();
      send(this.socket, {
        type: "authenticate",
        publicKey: profile.publicKey,
        signature: sign(
          null,
          Buffer.from("shizhi-relay:v1:" + p.nonce),
          profile.privateKey,
        ).toString("base64"),
        name: profile.name,
        watch: this.friends().map((f) => f.id),
      });
      return;
    }
    if (p.type === "ready") {
      this.status = "online";
      this.error = "";
      return;
    }
    if (p.type === "presence") {
      this.peers = Array.isArray(p.peers) ? p.peers : [];
      for (const id of this.guests.keys())
        if (!this.peers.some((p) => p.id === id)) this.guests.delete(id);
      if (this.hostId && !this.peers.some((p) => p.id === this.hostId)) {
        this.hostId = null;
        this.room = null;
        this.error = "主人已离线，你已返回自己的家园";
      }
      return;
    }
    if (p.type === "offline") {
      this.error = "好友当前不在线";
      const request = this.pending.get(p.rid);
      if (request) {
        request.reject(Error(this.error));
        this.pending.delete(p.rid);
      }
      return;
    }
    if (p.type !== "peer" || !validId(p.from) || !p.data) return;
    const { from, name, data: d } = p;
    if (d.type === "response") {
      const req = this.pending.get(d.rid);
      if (req?.from === from) {
        this.pending.delete(d.rid);
        if (d.error) req.reject(Error(String(d.error).slice(0, 500)));
        else {
          if (d.result?.html)
            d.result.html = sanitizeHtml(String(d.result.html), {
              allowedTags: [
                "p",
                "div",
                "span",
                "br",
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
                "sup",
                "sub",
                "hr",
              ],
              allowedAttributes: {},
            });
          req.resolve(d.result);
        }
      }
      return;
    }
    if (d.type === "friend-request") {
      if (this.isFriend(from)) this.route(from, { type: "friend-accept" });
      else if (!this.requests.some((r) => r.id === from))
        this.requests.push({ id: from, name });
      return;
    }
    if (d.type === "friend-accept") {
      if (this.outgoing?.has(from)) {
        this.outgoing.delete(from);
        this.addFriend(from, name);
      }
      return;
    }
    if (!this.isFriend(from)) return;
    if (d.type === "invite") {
      this.invitations = this.invitations.filter((i) => i.id !== from);
      this.invitations.push({ id: from, name, token: d.token });
      return;
    }
    if (d.type === "join") {
      if (this.invited.get(from) !== d.token) {
        this.route(from, {
          type: "response",
          rid: d.rid,
          error: "邀请已失效，请主人重新邀请",
        });
        return;
      }
      this.invited.delete(from);
      this.guests.set(from, {
        id: from,
        name,
        x: 50,
        scene: "home",
        focus: null,
      });
      this.route(from, {
        type: "response",
        rid: d.rid,
        result: this.publicRoom(),
      });
      this.publish();
      return;
    }
    if (d.type === "room" && from === this.hostId) {
      if (
        !d.room ||
        d.room.owner?.id !== from ||
        !Array.isArray(d.room.plants) ||
        !Array.isArray(d.room.people) ||
        !Array.isArray(d.room.catalog?.items) ||
        !Array.isArray(d.room.catalog?.points)
      )
        return;
      this.room = d.room;
      return;
    }
    if (d.type === "kick" && from === this.hostId) {
      this.hostId = null;
      this.room = null;
      this.error = "访问已结束，已返回自己的家园";
      return;
    }
    if (d.type === "leave") {
      this.guests.delete(from);
      this.publish();
      return;
    }
    if (d.type === "pose" && this.guests.has(from)) {
      const g = this.guests.get(from);
      g.x = Math.max(2, Math.min(98, Number(d.x) || 50));
      g.scene = d.scene === "home" ? "home" : "garden";
      g.seated = !!d.seated;
      g.focus = d.focus
        ? {
            seconds: Math.max(0, Number(d.focus.seconds) || 0),
            paused: !!d.focus.paused,
          }
        : null;
      this.publish();
      return;
    }
    if (["document", "file", "catalog", "point"].includes(d.type)) {
      try {
        if (!this.guests.has(from)) throw Error("请先接受邀请并进入好友家园");
        let result;
        if (d.type === "catalog")
          result = this.h.sharedCatalog({ query: d.query, offset: d.offset });
        else if (d.type === "point") result = this.h.sharedPoint(d.id);
        else if (d.type === "document")
          result = this.h.sharedDocument(d.id, d.page);
        else {
          const item = this.h.lib.get(d.id);
          if (item.private || item.deleted_at) throw Error("资料未共享");
          let asset = item.asset,
            inline = null;
          if (d.asset) {
            if (
              typeof d.asset !== "string" ||
              ![
                ...item.html.matchAll(
                  /<img\b[^>]*\bsrc="kbasset:\/\/asset\/([^"<>]+)"[^>]*>/g,
                ),
              ].some((match) => match[1] === d.asset)
            )
              throw Error("插图未共享");
            asset = d.asset;
          }
          if (!asset && item.kind === "note")
            inline = Buffer.from(item.html, "utf8");
          if (!asset && !inline) throw Error("此资料没有原始文件");
          const file = asset ? this.h.lib.assetPath(asset) : null,
            size = inline ? inline.length : fs.statSync(file).size,
            index = Number(d.index);
          if (
            !Number.isInteger(index) ||
            index < 0 ||
            index * 196608 >= Math.max(size, 1)
          )
            throw Error("无效分块");
          const buffer = Buffer.alloc(Math.min(196608, size - index * 196608));
          if (inline)
            inline.copy(
              buffer,
              0,
              index * 196608,
              index * 196608 + buffer.length,
            );
          else {
            const fd = fs.openSync(file, "r");
            try {
              fs.readSync(fd, buffer, 0, buffer.length, index * 196608);
            } finally {
              fs.closeSync(fd);
            }
          }
          result = {
            data: buffer.toString("base64"),
            size,
            index,
            title: item.title,
            kind: item.kind,
            ext: asset ? asset.split(".").pop() : "html",
          };
        }
        this.route(from, { type: "response", rid: d.rid, result });
      } catch (e) {
        this.route(from, { type: "response", rid: d.rid, error: e.message });
      }
      return;
    }
  }
  add(code) {
    let value;
    try {
      if (typeof code !== "string" || code.length > 5000) throw Error();
      value = JSON.parse(
        Buffer.from(code.replace(/^sz1:/, ""), "base64url").toString(),
      );
    } catch {
      throw Error("无效好友码");
    }
    if (!validId(value.id) || value.id === this.identity().id)
      throw Error("无效好友身份");
    if (this.isFriend(value.id)) throw Error("已经是好友");
    if (!this.outgoing) this.outgoing = new Set();
    this.outgoing.add(value.id);
    this.route(value.id, { type: "friend-request" });
    return true;
  }
  accept(id) {
    const request = this.requests.find((r) => r.id === id);
    if (!request) throw Error("好友请求不存在");
    this.route(id, { type: "friend-accept" });
    this.addFriend(id, request.name);
    this.requests = this.requests.filter((r) => r.id !== id);
    return true;
  }
  invite(id) {
    if (this.hostId) throw Error("请先返回自己的家园");
    if (!this.isFriend(id)) throw Error("不是好友");
    const token = randomUUID();
    this.invited.set(id, token);
    this.route(id, { type: "invite", token });
    return true;
  }
  async join(id) {
    const i = this.invitations.find((i) => i.id === id);
    if (!i) throw Error("邀请不存在");
    this.leave();
    this.room = await this.request(id, { type: "join", token: i.token });
    this.hostId = id;
    this.invitations = this.invitations.filter((i) => i.id !== id);
    return true;
  }
  leave() {
    if (this.hostId && this.status === "online")
      this.route(this.hostId, { type: "leave" });
    this.hostId = null;
    this.room = null;
    return true;
  }
  async document(id, page) {
    if (!this.hostId) throw Error("未进入好友家园");
    const content = await this.request(this.hostId, {
      type: "document",
      id,
      page,
    });
    if (content.chunked) {
      const file = await this.file(id);
      content.html = sharedHtml(Buffer.from(file.bytes).toString("utf8"));
    }
    return content;
  }
  async file(id, asset) {
    if (!this.hostId) throw Error("未进入好友家园");
    const host = this.hostId,
      first = await this.request(host, { type: "file", id, asset, index: 0 });
    if (first.size > 200 * 1024 * 1024 || first.size < 0)
      throw Error("共享文件超出大小限制");
    const parts = [Buffer.from(first.data, "base64")];
    for (let i = 1; i * 196608 < first.size; i++) {
      if (i % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 25));
      if (host !== this.hostId) throw Error("访问已结束");
      const part = await this.request(host, {
        type: "file",
        id,
        asset,
        index: i,
      });
      if (part.size !== first.size) throw Error("资料已变化，请重新打开");
      parts.push(Buffer.from(part.data, "base64"));
    }
    const bytes = Buffer.concat(parts);
    if (bytes.length !== first.size) throw Error("共享文件传输不完整");
    return { ...first, data: undefined, bytes: new Uint8Array(bytes) };
  }
  close() {
    this.disconnect();
    for (const socket of this.localServer?.clients || []) socket.terminate();
    this.localServer?.close();
  }
}
