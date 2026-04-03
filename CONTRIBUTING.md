# Contributing to StellaLib

Thank you for your interest in contributing to StellaLib! This guide will help you get started.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0.0 (runtime + test runner)
- [Node.js](https://nodejs.org/) >= 18.0.0
- A Lavalink server (v3 or v4) for integration testing

### Getting Started

```bash
# Clone the repository
git clone https://github.com/Roki-Stella-Projects/StellaLib.git
cd StellaLib

# Install dependencies
bun install

# Type-check
bun run lint

# Run tests
bun test

# Build
bun run build
```

## Project Structure

```
StellaLib/
├── src/
│   ├── Structures/
│   │   ├── Manager.ts      # Main hub — nodes, players, search, voice updates
│   │   ├── Node.ts          # Lavalink WebSocket connection + failover + autoplay
│   │   ├── Player.ts        # Guild-level playback control
│   │   ├── Queue.ts         # Track queue with maxSize + deduplication
│   │   ├── Rest.ts          # Lavalink REST API client (v3 + v4)
│   │   ├── Filters.ts       # Audio filters (EQ, timescale, karaoke, etc.)
│   │   ├── Types.ts         # All TypeScript interfaces and types
│   │   ├── Utils.ts         # TrackUtils, Structure, Plugin, type guards
│   │   ├── LRUCache.ts      # Bounded LRU cache with TTL
│   │   └── SessionStore.ts  # File-based session + player state persistence
│   ├── Utils/               # Validation helpers
│   └── index.ts             # Public exports
├── tests/                   # Bun test files
├── docs/                    # Wiki-style documentation
├── .github/                 # Issue/PR templates
├── CHANGELOG.md
├── THIRD-PARTY-NOTICES.md
└── README.md
```

## Making Changes

### Code Style

- **TypeScript** — All source code is TypeScript with strict typing
- **Tabs for indentation** — Match the existing codebase
- **No unnecessary comments** — Code should be self-documenting; use JSDoc for public APIs
- **Keep imports at the top** — Never import in the middle of a file

### Commit Messages

Use clear, descriptive commit messages:

```
fix: player.destroy() now deletes persisted state
feat: add queue maxSize enforcement and deduplication
docs: add seamless failover guide
```

### Testing

- Write tests for new features in the `tests/` directory
- Use `bun:test` (Bun's built-in test runner)
- Run `bun test` before submitting a PR
- Run `bun run lint` (`tsc --noEmit`) to ensure no type errors

### Documentation

- Update `docs/` guides if you change public APIs
- Update `README.md` if you add new features
- Add entries to `CHANGELOG.md` for user-facing changes
- Update `THIRD-PARTY-NOTICES.md` if you add new dependencies

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run `bun test` and `bun run lint`
5. Commit with a clear message
6. Push to your fork and open a PR
7. Fill out the PR template

## Reporting Issues

- Use the [Bug Report](https://github.com/Roki-Stella-Projects/StellaLib/issues/new?template=bug_report.md) template for bugs
- Use the [Feature Request](https://github.com/Roki-Stella-Projects/StellaLib/issues/new?template=feature_request.md) template for ideas
- Include `Debug` event logs when reporting bugs (`manager.on("Debug", console.log)`)

## License

By contributing, you agree that your contributions will be licensed under the [OSL-3.0](LICENSE) license.
