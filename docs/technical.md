# How pragmatic works

This explains how the features in `features/` are built.
It names the files to read for each part.

## Overview

```
browser (React, own canvas)  ──WebSocket /collab/<id>──┐
                             ──HTTP /api──────────────┤
Claude (Code, Desktop, any MCP client) ──HTTP /mcp────┤
                                                      ▼
                         one Node 24 process (Express 5)
                          ├─ live rooms: one Yjs document per open board or doc (memory)
                          ├─ Postgres: items, sharing, inbox, OAuth, and the board change log
                          ├─ headless Chrome: board pictures (PNG)
                          └─ Google APIs: sign-in, Drive copies
```

- Node 24 runs the TypeScript files directly (type stripping), so the server has no build step.
- `shared/` is code that the browser, the server and the tests all use: the object model, connector routing, layout, Mermaid and Excalidraw conversion, and document helpers.
- `web/` is the React 19 app, built by Vite. `web/src/engine/` is the canvas.

## Boards are Yjs documents

Every board and doc is one Yjs document (a CRDT).
Two people can change it at the same time and both changes are kept, with no locks and no "last save wins".

What is in a document (`shared/doc.ts`, `shared/model.ts`):
- `objects`: a map from object id to a map of fields (type, x, y, w, h, z, color, ...). One object is one entry, so edits to different objects never touch each other.
- Text fields are shared types, not strings, so two people typing in one box keep both edits: rich text (shapes, stickies, text boxes, mind map nodes `t.<node>`) is a `Y.XmlFragment` (see below); task descriptions and table cells (`c.<row>.<col>`) are `Y.Text`, written as a diff (`applyTextDiff`).
- `comments`: comment threads. The app writes them only through the server, which sets the author; readers skip a value that does not parse (an editor's socket can write this map).
- `settings` and `votes`: board theme, timer, voting.
- `pending`: Mermaid requests from Claude that wait for a browser (see below).
- Docs use the XML fragment `blocks` (BlockNote content).

Rich text (`shared/richtext.ts`, `web/src/engine/rich.tsx`):
- The text of shapes, stickies, text objects and mind map nodes (`t.<node>`) is a `Y.XmlFragment` in ProseMirror's shape: paragraphs, bullet and numbered lists, line breaks, mentions; marks bold, italic, underline, strike and link as text attributes.
- The browser edits it with ProseMirror through `y-prosemirror`, so two people typing in one box merge like any other text. Board undo also covers it.
- `objectJSON` gives every reader (MCP, search, Mermaid, Drive JSON) the plain text, and a portable copy of the formatting under `rich`, so duplicate, paste, templates and restore keep it.
- Plain-text writes (Claude, the API) go through `setPlain`: unchanged lines stay, a changed line is diffed in place, so formatting elsewhere and concurrent typing survive.
- Boards from before rich text hold a `Y.Text` there; it becomes a fragment the first time someone edits it.
- Mind map nodes with formatting are measured by the browser itself (a hidden box with the same markup), plain ones by canvas text metrics.
- A mention added to rich text is seen in the document change on the server (`addedMentions`) and notifies that person.

Z-order: each object has a number `z`. Sections, frames and stacks have their own ranges (`SECTION_Z`, `FRAME_Z`, `STACK_Z`), so they stay behind their content.
Each connector gets its own SVG layer at its own `z`; a new connector takes a `z` just below the lower of its two ends, so a line never covers the shapes it joins.

## Live sync (`server/collab.ts`)

- The browser uses `y-websocket`'s provider; the server speaks the same protocol (`y-protocols` sync and awareness) on `/collab/<id>`.
- The upgrade checks the session cookie and the role first, then loads the room, then opens the socket.
- A room holds the live document, the presence (awareness: cursors, selections, who types where) and the open sockets.
- Viewers and commenters get the document and presence, but the server drops their document changes.
- Every change is broadcast to the other sockets at once. It is written to the database in small batches (every 250 ms).
- Writes of one room run one after another, so the log keeps the order of the changes. If the database does not answer, the changes stay in memory and the write is tried again.
- A room stays loaded 60 seconds after the last person leaves, so reconnects and Claude's calls reuse it.
- On SIGTERM the server writes everything still in memory, then stops.
- Server-side edits (Claude, restore, templates) go through `editBoard(id, fn, author)`: `fn` runs on the live document, so open tabs see the change at once, and the author is credited in the history.

Limit: rooms live in one process, so pragmatic runs one replica.
To run more, the rooms need a shared Yjs backend (for example Redis or Hocuspocus); see the `ponytail:` comment in `collab.ts`.

## Storage (`server/db.ts`, `server/history.ts`)

Database: Postgres.
- With `DATABASE_URL`, the `pg` driver connects to that server (`?sslmode=verify-full` checks its TLS certificate; a private CA goes in `NODE_EXTRA_CA_CERTS`).
- Without it, PGlite runs: the real Postgres engine compiled to WebAssembly, inside the Node process. Local development keeps data in `data/pg/`; tests use an empty database in memory for each test file.
- Queries go through three helpers: `all`, `one`, `run`. `tx(fn)` runs `fn` in a transaction; queries inside it use the transaction's connection (AsyncLocalStorage).
- Schema changes are numbered steps in `db.ts`, applied once each at start, under an advisory lock.

Tables:
- `users`, `sessions`, `tokens` (personal MCP tokens, hashed).
- `items`: folders, boards and docs, with owner, scope (private or team), parent folder, link access, thumbnail, search text, trash time.
- `shares`: per-person roles. `notifications`: the inbox. `stars`.
- `updates` and `checkpoints`: the board change log (below).
- `workspace_themes`, `workspace_settings`, `templates`.
- `google_tokens` (encrypted), `drive_files`.
- `oauth_clients`, `oauth_codes`, `oauth_tokens` (hashed).

The change log:
- A board is never saved as a whole file. Each batch of Yjs updates is a new row in `updates` (append-only), with the time and the authors.
- `seq` comes from one sequence for all boards, so it orders the rows of each board.
- A checkpoint is the full state at a log position. One is written every 500 updates and when the last person leaves, so loading stays fast: latest checkpoint + the updates after it.
- Any past moment = the checkpoint before it + the updates up to it. This is the time machine: a version id is a log position.
- The version list groups updates into editing sessions (a pause of more than 5 minutes starts a new one).
- Thinning (every 6 hours): updates older than 30 days merge into one per hour, older than 6 months into one per day (`Y.mergeUpdates`), so each kept point costs only its own changes. Checkpoints the log can rebuild are deleted except the newest; checkpoints older than the first update in the log (from earlier builds) stay, one per day.

Uploaded images are files named by their content hash in `data/files/` (a volume in the container). The server checks the real type from the first bytes (PNG, JPEG, GIF, WebP; no SVG).

## Access control (`server/store.ts`)

Roles, from weak to strong: view, comment, edit, owner.
One SQL expression computes a person's role on an item:
- the owner is owner;
- team items, an edit share or edit link access give edit;
- then comment, then view, from a share or the link access;
- else none, and the item does not exist for that person (404, not 403).

Every API route and every MCP tool asks for the role it needs (`getItem(user, id, need)`).
Lists (sidebar, stars, inbox) compute the role in the same query, so they never show what a person cannot open.
Moving an item into a folder gives it the folder's scope; other people's items cannot move into a private folder.

## Sign-in and tokens (`server/auth.ts`, `server/oauth.ts`, `server/google.ts`)

- Modes (`AUTH`): `local` (no sign-in, loopback only, and requests must name this server as Host, against DNS rebinding), `oidc` (discovery, PKCE, userinfo), `password` (scrypt, invite links), `google` (PKCE; with `ALLOWED_EMAIL_DOMAINS`, the `hd` claim must be that domain).
- `users.activated_at` is set on a person's first team-mode sign-in. The first-admin form is open only while no one is activated, and only admins get invite links (a link sets the account's password).
- Failed password sign-ins: 10 in 15 minutes per address, and per email from one address. Behind a proxy, `TRUST_PROXY`.
- The session is a random cookie; the database keeps only its SHA-256 hash.
- Drive copies ask for `drive.file` (with Google sign-in, or "Connect Google Drive" in any mode). Google refresh tokens are encrypted with AES-256-GCM (key: `PRAGMATIC_SECRET`).
- MCP clients use pragmatic's own OAuth 2.1 server: metadata discovery, dynamic client registration, consent page with a CSRF cookie, PKCE S256, one-time codes, access tokens for 1 hour, rotating refresh tokens for 30 days.
- A code and a used refresh token are taken with one `DELETE ... RETURNING`, so each works once, even for two requests at the same time.
- Token prefixes: `pgo_` access, `pgr_` refresh, `pgc_` client, `pgk_` code, `pgm_` personal token.

## Comments and inbox (`server/comments.ts`, `server/inbox.ts`)

- Comments are written only by the server, into the board document, with the signed-in person as author. Mentions are kept only for real user ids.
- Notifications: a new comment tells mentioned people, then earlier people in the thread, then watchers of the card; never the author.
- Card assignments are noticed in the document change itself (`hooks.objects`), so an assignment by a person, by Claude or by a restore notifies the same way.
- Nobody gets a notification for a board they cannot open.

## Canvas (`web/src/engine/`)

- `Canvas.tsx` draws objects as HTML elements and SVG (connectors, freehand) inside one transformed layer: pan and zoom are one CSS transform.
- Connectors route from `shared/route.ts` (elbow, straight, curved) between object sides; ends can bind to an object or to one mind map node (`{ id, node }`).
- Mind map layout is `shared/mindmapLayout.ts`; table and mind map edits are pure functions in `shared/tableOps.ts` and `shared/mindmapOps.ts`, so the browser and Claude's tools change them the same way.
- Undo is a Yjs UndoManager that tracks only this tab's own changes.
- `ContextMenu.tsx` is the right-click menu with submenus; `Toolbar.tsx` has the mode stack (Diagram, Wireframe, Task) and the "All tools" palette.

Mermaid: the converter needs a DOM to lay out the diagram, so Claude's `add_mermaid` puts the request in the board's `pending` map.
The open tab of the present person with the lowest client id converts it to shapes and removes the request.

## Docs (`web/src/docs/`, `server/docs.ts`)

- BlockNote (on ProseMirror) edits the `blocks` fragment through its Yjs collaboration extension, with live cursors from the board's presence.
- Custom blocks: `embed` (a live PNG of a board) and `callout`. Their definitions are in `shared/docSchema.ts`, used by the web editor and by the server, so the server can read every doc.
- The server converts Markdown with BlockNote's server tools (loaded on first use): Claude's `write_doc`, `read_doc`, and Drive copies of docs.

## Pictures and Drive (`server/render.ts`, `server/drive.ts`)

- PNGs come from a headless Chrome that the server starts once and drives over the DevTools protocol.
  It opens `/b/<id>?render=1` with a 2-minute session of the requesting person and calls the app's own exporter, so a server picture looks exactly like a browser export.
- Drive copies use the owner's own token, into a "pragmatic" folder in their My Drive.
  The same file ids are updated, so Drive keeps revisions. A copy is scheduled at most every 10 minutes while a board changes, and 30 seconds after the last person leaves.

## MCP server (`server/mcp.ts`)

- `POST /mcp` with a bearer token (OAuth or personal). Each request builds a stateless MCP server bound to that person (Streamable HTTP transport).
- Tools work on the live room through `editBoard`, with the person's role checked first, so changes appear in open tabs at once and are credited as "<name> (Claude)".
- Batches use the agent's own ids, so connectors in the same call can refer to new shapes; `placeBatch` puts new content to the right of what is on the board.

Claude Desktop extension (`claude-desktop/`):
- A `.mcpb` bundle of `mcp-remote` (pinned) with a manifest. Claude Desktop runs it with its built-in Node.
- `mcp-remote` registers as an OAuth client named "Claude Desktop", opens the browser for the consent page, and keeps the tokens.
- `npm run build` packs it into `dist/pragmatic.mcpb`; the server serves it at `/pragmatic.mcpb`.

Desktop app (`desktop/`):
- Electron. The board window has no Node access and no preload; links to other sites open in the system browser.
- Built-in server (the default): a `utilityProcess` runs `server/main.ts` with Electron's Node, `AUTH=local`, port 3133, data in the app's data folder. The packaged app carries the server in `Resources/server`.
- The other choice is any pragmatic server URL. Settings also turns the Claude panel off.
- The Claude panel is a terminal (node-pty and xterm.js) that runs the person's own `claude` CLI in their login shell.

## Deployment

- Image: `Dockerfile`, multi-arch (amd64 and arm64), with Chromium. Base images come from ECR Public.
- One replica only (board rooms live in memory), with a volume for `/data`. A proxy in front must allow long-lived WebSockets (`/collab`).
- `/healthz` checks that the process and the database answer.

## Tests

- `npm test`: node:test, each file on its own in-memory PGlite. `npm run typecheck`.
- CI (`.github/workflows/ci.yml`): tests on PGlite, and the same tests on Postgres 18 (one empty database per test file).
- The MCP tools are tested over the SDK's in-memory transport (`server/mcp.test.ts`), live board sockets with a real WebSocket client (`server/collab-access.test.ts`).

## Known limits

- One server process (rooms in memory).
- A modified client could write board data that the interface would not write (comment threads, the card activity log, votes before the end). The server checks roles, not the content of Yjs updates.
- Mermaid types other than flowchart and sequence arrive as a picture.
- Drive is tested against a fake Google API only.
