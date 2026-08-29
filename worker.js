import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const id = env.MOVIE_ROOM.idFromName("moscow-samara");
      return env.MOVIE_ROOM.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class MovieRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }

    const user = url.searchParams.get("user");

    if (!["nebur", "natalya"].includes(user)) {
      return new Response("Invalid user", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const existing = this.ctx.getWebSockets();

    const roleAlreadyConnected = existing.some(ws => {
      try {
        return ws.deserializeAttachment()?.user === user;
      } catch {
        return false;
      }
    });

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ user });

    if (roleAlreadyConnected) {
      server.send(JSON.stringify({
        type: "error",
        code: "already-connected"
      }));
      server.close(1000, "Already connected");

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    server.send(JSON.stringify({
      type: "welcome",
      user
    }));

    this.broadcastPresence();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  webSocketMessage(ws, message) {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const sender = ws.deserializeAttachment()?.user;

    data.from = sender;

    for (const socket of this.ctx.getWebSockets()) {
      const receiver = socket.deserializeAttachment()?.user;

      if (receiver !== sender) {
        try {
          socket.send(JSON.stringify(data));
        } catch {}
      }
    }
  }

  webSocketClose() {
    setTimeout(() => this.broadcastPresence(), 150);
  }

  webSocketError() {
    setTimeout(() => this.broadcastPresence(), 150);
  }

  broadcastPresence() {
    const users = this.ctx.getWebSockets()
      .map(ws => {
        try {
          return ws.deserializeAttachment()?.user;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const message = JSON.stringify({
      type: "presence",
      users
    });

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {}
    }
  }
}
