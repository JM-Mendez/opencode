- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Opencode Server Setup

There are two opencode servers running:

- **Official server** (port `4096`): installed via `curl -fsSL https://opencode.ai/install | bash` to `~/.opencode/bin/opencode`
- **Custom development server** (port `4196`): built from this repo at `packages/opencode/script/build.ts` and copied to `~/.opencode/bin/opencode-custom`

### Building the custom binary

```bash
cd packages/opencode
bun run build --single
cp dist/opencode-darwin-arm64/bin/opencode ~/.opencode/bin/opencode-custom
chmod 755 ~/.opencode/bin/opencode-custom
```

### Database sharing

The custom build uses a separate database by default (`opencode-<channel>.db`). To make both servers share the same database (`opencode.db`), start the custom server with `OPENCODE_DISABLE_CHANNEL_DB=1`.

### Restarting servers

**Official server (port 4096)**:
```bash
pkill -f 'opencode web --hostname 0.0.0.0 --port 4096'
nohup ~/.opencode/bin/opencode web --hostname 0.0.0.0 --port 4096 > /tmp/opencode-server-4096.log 2>&1 &
```

**Custom server (port 4196)**:
```bash
pkill -f 'opencode-custom web --hostname 0.0.0.0 --port 4196'
OPENCODE_DISABLE_CHANNEL_DB=1 nohup ~/.opencode/bin/opencode-custom web --hostname 0.0.0.0 --port 4196 > /tmp/opencode-web-4196.log 2>&1 &
```

Verify both are running:
```bash
lsof -nP -iTCP:4096 -sTCP:LISTEN
lsof -nP -iTCP:4196 -sTCP:LISTEN
```

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
