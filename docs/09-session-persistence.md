# Session Persistence

StellaLib can persist Lavalink session IDs across bot restarts, allowing music to keep playing without interruption.

## How Session Resuming Works

```
First boot:
1. Bot connects to Lavalink → gets new sessionId
2. sessionId saved to store
3. Bot shuts down → session persisted

Second boot:
1. Bot loads sessionId from store
2. Sends sessionId in WS headers (Session-Id for v4, Resume-Key for v3)
3. Lavalink recognizes the session → resumes it
4. All players keep their state → music continues playing
```

**Important:** Lavalink only holds sessions for a limited time (`resumeTimeout`). If the bot takes too long to reconnect, the session expires.

## FileSessionStore

The built-in `FileSessionStore` saves session IDs to a JSON file on disk.

```ts
import { StellaManager, FileSessionStore } from "@stella_project/stellalib";

const manager = new StellaManager({
  sessionStore: new FileSessionStore("./sessions.json"),
  nodes: [
    {
      identifier: "main",
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      resumeStatus: true,     // Enable session resuming
      resumeTimeout: 120,     // Lavalink holds session for 120 seconds
    },
  ],
  send(id, payload) { /* ... */ },
});
```

The `sessions.json` file will look like:

```json
{
  "main": "abc123-session-id-from-lavalink"
}
```

## Custom Session Store

You can implement any storage backend by implementing the `SessionStore` interface:

```ts
interface SessionStore {
  get(nodeId: string): Promise<string | null> | string | null;
  set(nodeId: string, sessionId: string): Promise<void> | void;
  delete(nodeId: string): Promise<void> | void;
}
```

### Redis Example

```ts
import Redis from "ioredis";

const redis = new Redis();

const manager = new StellaManager({
  sessionStore: {
    async get(nodeId) {
      return await redis.get(`stellalib:session:${nodeId}`);
    },
    async set(nodeId, sessionId) {
      // Set with TTL matching resumeTimeout
      await redis.set(`stellalib:session:${nodeId}`, sessionId, "EX", 300);
    },
    async delete(nodeId) {
      await redis.del(`stellalib:session:${nodeId}`);
    },
  },
  nodes: [{ /* ... */ }],
  send(id, payload) { /* ... */ },
});
```

### Database Example

```ts
const manager = new StellaManager({
  sessionStore: {
    async get(nodeId) {
      const row = await db.query("SELECT session_id FROM sessions WHERE node_id = ?", [nodeId]);
      return row?.session_id ?? null;
    },
    async set(nodeId, sessionId) {
      await db.query(
        "INSERT INTO sessions (node_id, session_id) VALUES (?, ?) ON CONFLICT (node_id) DO UPDATE SET session_id = ?",
        [nodeId, sessionId, sessionId]
      );
    },
    async delete(nodeId) {
      await db.query("DELETE FROM sessions WHERE node_id = ?", [nodeId]);
    },
  },
  // ...
});
```

## Session Lifecycle

### On Connect

1. Node calls `sessionStore.get(nodeId)` to load saved session ID
2. If found, sends it in WS headers:
   - **v4:** `Session-Id: <sessionId>`
   - **v3:** `Resume-Key: <sessionId>`
3. Lavalink checks if the session is still valid

### On Ready (v4)

1. Lavalink sends `ready` op with `{ sessionId, resumed: true/false }`
2. Node saves the session ID: `sessionStore.set(nodeId, sessionId)`
3. Configures resume: `PATCH /v4/sessions/{sessionId}` with `{ resuming: true, timeout: N }`
4. If resumed: syncs player state from Lavalink
5. If not resumed: rebuilds players from local state

### On Ready (v3)

1. No `ready` op in v3 — Node generates a synthetic session on WS open
2. Saves session ID to store
3. Configures resume via WS: `{ op: "configureResuming", key: sessionId, timeout: N }`

### On Shutdown

1. `manager.shutdown()` is called
2. For each node: `sessionStore.set(nodeId, sessionId)` — persists current session
3. Nodes close WebSocket cleanly
4. Lavalink holds the session for `resumeTimeout` seconds

### On Disconnect (unexpected)

1. WebSocket closes unexpectedly
2. Session ID is already persisted (was saved on ready)
3. Node reconnects with backoff, sending the saved session ID
4. If Lavalink still has the session → resume succeeds

## Configuration Tips

- **`resumeTimeout`** — Set this high enough for your bot to restart. 120 seconds is a good default. For deployments with longer restart times, use 300+.
- **`resumeStatus: true`** — Must be enabled on the node config for resuming to work.
- **Use Redis in production** — `FileSessionStore` works great for single-instance bots. For clustered/sharded bots, use Redis or a database so all instances share session state.

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Sessions not resuming | `resumeStatus` is false | Set `resumeStatus: true` in node config |
| Session expired | Bot took too long to restart | Increase `resumeTimeout` |
| Players gone after resume | v3 doesn't support player sync | Expected behavior — v3 limitation |
| Session file not created | Permissions issue | Check write permissions on the file path |
