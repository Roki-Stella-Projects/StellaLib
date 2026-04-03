# Third-Party Notices

This file contains notices and licenses for third-party software included in
or used by StellaLib.

---

## LithiumX

- **Project:** LithiumX
- **Repository:** https://github.com/anantix-network/LithiumX
- **Copyright:** Copyright (c) 2025 Anantix Network
- **License:** MIT License

### Scope of Derived Work

StellaLib's architecture, class structure, and significant portions of its
source code are derived from LithiumX. The following components contain code
originally authored by Anantix Network and subsequently modified:

| File | Derived From |
|---|---|
| `src/Structures/Manager.ts` | `LithiumX/src/Structures/Manager.ts` |
| `src/Structures/Node.ts` | `LithiumX/src/Structures/Node.ts` |
| `src/Structures/Player.ts` | `LithiumX/src/Structures/Player.ts` |
| `src/Structures/Queue.ts` | `LithiumX/src/Structures/Queue.ts` |
| `src/Structures/Rest.ts` | `LithiumX/src/Structures/Rest.ts` |
| `src/Structures/Filters.ts` | `LithiumX/src/Structures/Filters.ts` |
| `src/Structures/Utils.ts` | `LithiumX/src/Structures/Utils.ts` |
| `src/Structures/Types.ts` | Extracted from multiple LithiumX source files |
| `src/Utils/FiltersEqualizers.ts` | `LithiumX/src/Utils/FiltersEqualizers.ts` |
| `src/Utils/ManagerCheck.ts` | `LithiumX/src/Utils/ManagerCheck.ts` |
| `src/Utils/NodeCheck.ts` | `LithiumX/src/Utils/NodeCheck.ts` |
| `src/Utils/PlayerCheck.ts` | `LithiumX/src/Utils/PlayerCheck.ts` |

### Modifications Made by StellaLib Authors

- Added `channelId` to voice PATCH payloads (Lavalink v4 compliance)
- Implemented promise-based voice readiness system
- Added session resume with `Session-Id` header and player state sync
- Replaced `@discordjs/collection` with native `Map` iteration
- Added exponential backoff on WebSocket reconnect
- Extracted shared types into `Types.ts` to eliminate circular dependencies
- Added `Debug` event for internal logging
- Improved error handling to prevent unhandled promise rejections
- Added search result caching

### Full MIT License Text

```
MIT License

Copyright (c) 2025 Anantix Network

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Erela.js

- **Project:** Erela.js
- **Repository:** https://github.com/MenuDocs/erela.js
- **License:** Apache-2.0
- **Note:** Erela.js pioneered the Lavalink client pattern in the JavaScript ecosystem. Many design patterns used in LithiumX (and by extension StellaLib) — such as the Manager/Node/Player/Queue class hierarchy, the plugin system, and the event-driven architecture — originated from Erela.js. StellaLib does not contain direct code from Erela.js, but acknowledges its foundational influence on the Lavalink client ecosystem.

---

## MagmaStream

- **Project:** MagmaStream
- **Repository:** https://github.com/Magmastream-NPM/magmastream
- **License:** ISC
- **Note:** MagmaStream provided inspiration for advanced features in StellaLib, including improved node management strategies, penalty-based load balancing, and audio quality optimizations. StellaLib does not contain direct code from MagmaStream, but acknowledges its contributions to the Lavalink client ecosystem.

---

## Lavalink

- **Project:** Lavalink
- **Repository:** https://github.com/lavalink-devs/Lavalink
- **Website:** https://lavalink.dev/
- **License:** MIT License
- **Note:** Lavalink is the audio server that StellaLib connects to. StellaLib implements the Lavalink client protocol (both v3 and v4) as documented in the Lavalink specification.

---

## tiny-typed-emitter

- **Repository:** https://github.com/binier/tiny-typed-emitter
- **License:** MIT License

## ws

- **Repository:** https://github.com/websockets/ws
- **License:** MIT License
