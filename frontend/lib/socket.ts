"use client";

import { io, type Socket } from "socket.io-client";
import { BACKEND_URL } from "./api";

/**
 * The tab's one live connection to the backend, shared by everything that
 * listens on it: sign-out events, the job queue and History's live grid.
 *
 * Each of those used to open its own. That meant two or three connections
 * per tab, each with its own handshake and session check, each joining the
 * same rooms. Every update then crossed the network once per connection,
 * including the once-a-second job progress with its image previews. On a
 * slow link that is bandwidth taken from the page itself.
 *
 * Counted out: `acquireSocket` hands back the shared socket, opening it on
 * first use, and `releaseSocket` closes it once nobody holds it. On sign-out
 * every holder lets go, so the next person's socket is opened fresh, with
 * their cookies.
 */
let socket: Socket | null = null;
let holders = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Before re-dialling when the server turned the socket away only because it couldn't check the session. */
const RETRY_MS = 5_000;

export function acquireSocket(): Socket {
  holders += 1;
  if (!socket) {
    const created = io(BACKEND_URL, { withCredentials: true });
    // The server couldn't reach the central login to check the session,
    // which is not a sign-out. socket.io doesn't retry a refused handshake on
    // its own, so dial again shortly.
    created.on("connect_error", (err) => {
      if (err.message !== "auth_unavailable") return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (socket === created) created.connect();
      }, RETRY_MS);
    });
    socket = created;
  }
  return socket;
}

export function releaseSocket() {
  holders = Math.max(0, holders - 1);
  if (holders === 0 && socket) {
    clearTimeout(retryTimer);
    socket.disconnect();
    socket = null;
  }
}
