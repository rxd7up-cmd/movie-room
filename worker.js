import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", {
          status: 426
        });
      }

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
    const user = url.searchParams.get("user");

    if (!["nebur", "natalya"].includes(user)) {
      return new Response("Invalid user", {
        status: 400
      });
    }

    /*
      Si el mismo usuario recarga la página,
      cerramos su conexión anterior.
      Esto evita conexiones fantasma.
    */
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const info = ws.deserializeAttachment();

        if (info?.user === user) {
          ws.close(1000, "Replaced by new connection");
        }
      } catch {}
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      user
    });

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

    let sender = null;

    try {
      sender = ws.deserializeAttachment()?.user;
    } catch {}

    data.from = sender;

    /*
      Enviamos solamente al otro usuario.
    */
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const receiver =
          socket.deserializeAttachment()?.user;

        if (receiver && receiver !== sender) {
          socket.send(JSON.stringify(data));
        }
      } catch {}
    }
  }

  webSocketClose() {
    setTimeout(() => {
      this.broadcastPresence();
    }, 100);
  }

  webSocketError() {
    setTimeout(() => {
      this.broadcastPresence();
    }, 100);
  }

  broadcastPresence() {
    const users = [];

    for (const socket of this.ctx.getWebSockets()) {
      try {
        const user =
          socket.deserializeAttachment()?.user;

        if (user && !users.includes(user)) {
          users.push(user);
        }
      } catch {}
    }

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
