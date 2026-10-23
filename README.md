# pragmatic

A diagram workspace, modelled on Whimsical: boards, flowcharts, mind maps, wireframes, task cards and docs.
Boards run on pragmatic's own canvas engine with live multi-user editing.
Run it for yourself (no sign-in), or on your network for a team (OpenID Connect, passwords or Google sign-in).
Claude Code, Claude Desktop and other MCP clients connect through MCP, so a Claude session can draw boards, rebuild screenshots as editable diagrams, and import diagrams from Whimsical, Mermaid or Excalidraw.

What works, per area: `docs/features/`.
How it is built: `docs/technical.md`.

Status: diagram, wireframe and task modes, docs, sharing, inbox, Drive copies and the Claude integrations are done.
See Roadmap for what is next.

## Run it

Three ways, with the same app and data model.
Every setting is an environment variable; `.env.example` lists them all with their defaults.

### For yourself, on this machine

No sign-in, one person, data in one folder.
pragmatic then listens on localhost only and refuses to start on a network address without a sign-in mode.

With Docker:

```sh
docker compose up -d        # builds the image the first time; data in the volume pragmatic-data
open http://localhost:3100
```

From source (Node 24):

```sh
npm install
npm run build
npm start                   # http://localhost:3100, data in ./data
```

Backup to Google Drive (optional): pragmatic copies each board (a picture and the full data, or Markdown for docs) to a "pragmatic" folder in your own Drive.
1. In [Google Cloud Console](https://console.cloud.google.com), create a project, enable the Google Drive API, and set up the OAuth consent screen (External, in testing, with yourself as a test user, is enough for one person).
2. Create an OAuth client ID of type "Web application" with the redirect URI `http://localhost:3100/auth/google/callback` (your `BASE_URL` + `/auth/google/callback`).
3. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and restart.
4. In pragmatic, open Settings and choose "Connect Google Drive".

pragmatic asks only for `drive.file`: it can see and change only the files it made.

### For a team on a local network

One server for the team; people open it in their browser.
In `.env`:

```sh
AUTH=oidc                       # or password, or both: AUTH=oidc,password
BASE_URL=http://pragmatic.lan:3100
PRAGMATIC_BIND=0.0.0.0          # docker compose: reachable from the network (from source: HOST=0.0.0.0)
ALLOWED_EMAIL_DOMAINS=yourcompany.com   # optional: who may sign in and be shared with
```

Sign-in modes:
- `oidc`: your identity provider (Keycloak, Authentik, Okta, Microsoft Entra, JumpCloud, Google Workspace, and others).
  Register pragmatic as a confidential client with redirect URI `<BASE_URL>/auth/oidc/callback` and the scopes `openid email profile`, then set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and, for the button, `OIDC_NAME`.
  People appear on their first sign-in.
- `password`: accounts in pragmatic. The first person to open a new install creates the admin account.
  pragmatic sends no email: an admin gets an invite link to pass on (Settings > People, or by sharing a board with a new address). Other people who share with a new address are told to ask an admin. The same kind of link resets a forgotten password.
- `google`: Google sign-in (needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, redirect URI `<BASE_URL>/auth/google/callback`). With `ALLOWED_EMAIL_DOMAINS`, only accounts of that Google Workspace can sign in.

Sharing works the same in every mode: "Team" boards are open to everyone who can sign in; private boards are shared per person by email (edit, comment or view) or by link.
The first person who ever signs in is an admin; admins manage people in Settings: make admin, remove access (signs them out at once), invite and reset links.

For https, put a reverse proxy in front (Caddy, nginx, Traefik) and set `BASE_URL=https://...`; cookies then become Secure.
Also set `TRUST_PROXY` (for example `TRUST_PROXY=1` for one proxy), so the sign-in limits see each person's address and not the proxy's.
Run one pragmatic server per team: live boards are kept in its memory.

### Data and backups

Without `DATABASE_URL`, pragmatic uses its built-in database (PGlite, the Postgres engine in-process) in the data folder (`PRAGMATIC_DATA`, default `./data`, `/data` in the container), next to uploaded images and the key file.
For a larger team, or to back up with standard tools, set `DATABASE_URL` to a Postgres server (`docker compose --profile postgres up -d` starts one).
Back up the built-in database by stopping pragmatic and copying the data folder (or the `pragmatic-data` volume); with Postgres, use `pg_dump` and copy the files folder.
Every board also keeps its own history inside pragmatic (Version history).

### Development

```sh
npm install
cp .env.example .env    # set BASE_URL=http://localhost:5173 and PRAGMATIC_DEV_LOGIN=you@example.com
npm run dev             # API on 127.0.0.1:3100, web with hot reload on http://localhost:5173
```

Checks: `npm test` (node:test, each file on its own in-memory PGlite) and `npm run typecheck`.
To run the tests on a real Postgres, give each test file an empty database in `DATABASE_URL`.

### Container image

`Dockerfile` builds one image for linux/amd64 and linux/arm64, with Chromium for board pictures:

```sh
docker buildx build --platform linux/amd64,linux/arm64 --push -t <registry>/pragmatic:<tag> .
```

The image listens on `0.0.0.0:3100`, keeps its data in `/data` (mount a volume there), and answers `/healthz` (which also checks the database).
For a Postgres server whose TLS certificate comes from a private certificate authority (for example Amazon RDS), mount the CA file and point `NODE_EXTRA_CA_CERTS` at it, then add `?sslmode=verify-full` to `DATABASE_URL`.
Google refresh tokens are encrypted (AES-256-GCM) with `PRAGMATIC_SECRET`, or a key file in the data folder; keep the key out of backups that leave your control.

## Connect Claude

Claude Desktop (no Node or Claude Code needed):

1. In pragmatic, open Settings & Claude and download the extension (`/pragmatic.mcpb`), then open the file. Claude Desktop installs it.
2. Paste the MCP address that Settings shows (for example `http://localhost:3100/mcp`).
3. On the first pragmatic request, a browser page asks you to allow access.

The extension (`claude-desktop/`) is `mcp-remote` pointed at the server; Claude Desktop runs it with its built-in Node.
`npm run build` packs it into `dist/pragmatic.mcpb`.
The machine must reach the server.
Claude Desktop "custom connectors" connect from Anthropic's cloud, so they work only once the server is reachable from the internet.

Claude Code:

1. Run `claude mcp add --transport http pragmatic http://localhost:3100/mcp` (your server's address, `/mcp`).
2. In Claude Code, run `/mcp`, pick pragmatic and choose Authenticate. A browser page asks you to allow it, after you sign in to pragmatic (no sign-in in personal mode).
3. Ask Claude, for example: "Draw our login flow as a flowchart on a new pragmatic board", or paste a screenshot and say "Rebuild this in pragmatic".

The MCP endpoint is its own OAuth 2.1 server (discovery, dynamic client registration, PKCE, rotating refresh tokens), so it works with any MCP client and does not depend on Claude.
Settings lists connected apps and can disconnect them.
Clients without OAuth can still use a `pgm_` token from Settings with `--header "Authorization: Bearer pgm_..."`.

Claude signs in with the user's own Claude account through Anthropic's own flow.
pragmatic never sees or stores Claude credentials.
Anthropic does not allow third-party apps to offer "Sign in with Claude" ([terms](https://code.claude.com/docs/en/legal-and-compliance)), so the MCP connector is the integration.

MCP tools: `list_items`, `search`, `list_templates`, `create_board` (optionally from a template), `create_folder`, `read_board`, `add_objects`, `update_objects`, `delete_objects`, `search_icons`, `add_mermaid`, `add_wireframe`, `add_tasks`, `update_task`, `add_mindmap`, `edit_mindmap`, `add_table`, `update_table`, `add_link`, `add_image`, `import_excalidraw`, `add_comment`, `read_comments`, `share_board`, `export_board` (PNG image, JSON or Mermaid), `copy_to_drive`, `create_doc`, `read_doc`, `write_doc` (docs as Markdown).

## Desktop app

`desktop/` is an Electron app for macOS: the board on the left, a Claude panel on the right (Claude > Claude Panel, ⇧⌘K).
By default it runs pragmatic inside the app (the built-in server): one person, no sign-in, nothing else to install.
Settings (⌘,) switches to another server, such as your team's.
The panel is a terminal that runs your own `claude` CLI in your login shell, so Claude uses your own Claude account.
The app never signs in to Claude.
Turn the panel off in Settings to use pragmatic without Claude Code.

```sh
cd desktop
npm install    # node-pty uses its N-API prebuilds; postinstall makes its spawn-helper executable (1.1.0 ships it without +x)
npm start      # the built-in server runs the repo itself; run `npm run build` in the repo first
npm run dist   # unsigned dmg for arm64 and x64 in desktop/dist/
```

Built-in server:
- Electron's own Node (24) runs `server/main.ts` in a utility process with `AUTH=local`, on http://localhost:3133.
- Data (the database, images, the key file) is in the app's data folder, `~/Library/Application Support/pragmatic/data`. The server log is `server.log` next to it.
- Optional settings for it go in `pragmatic.env` in that folder, for example `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Google Drive backup (redirect URI `http://localhost:3133/auth/google/callback`).
- On quit, the app stops the server (SIGTERM), which writes what is still in memory.
- `npm run dist` copies the server, the web app and its production modules (`stage-server.mjs`) into the app's `Resources/server` (`after-pack.cjs`).
- Board pictures (Drive copies, `export_board`) need Chrome or Chromium on the computer.

Share the app for testing:
- Send `desktop/dist/pragmatic-<version>-arm64.dmg` (Apple silicon) or `pragmatic-<version>.dmg` (Intel).
- The app is not signed, so macOS blocks it on the first open. Drag it to Applications, then run `xattr -dr com.apple.quarantine /Applications/pragmatic.app` once, or open System Settings > Privacy & Security > Open Anyway.
- Signing and notarization need an Apple Developer ID; with one, set `mac.identity` and the notarize settings in `desktop/package.json`.

- Claude > Connect Claude to pragmatic runs `claude mcp add --transport http -s user pragmatic <server>/mcp` in the panel. Then type `/mcp` in Claude and choose Authenticate.
- Claude > Choose Folder sets the folder Claude runs in (default: your home folder).
- The board page has no Node access and no preload. Only the local panel and settings pages get the small API in `desktop/preload.js`.
- Behind a TLS-inspecting proxy, set `NODE_EXTRA_CA_CERTS=<your proxy's CA file>` for `npm install` and `npm run dist`.
- Smoke test: `PRAGMATIC_SMOKE_DIR=/tmp/pgm npm start` starts with fresh app data in that folder, opens the panel, writes screenshots and quits.
- The icon comes from `web/public/favicon.svg`: `bash build/make-icon.sh` in `desktop/`.

## How it works

- `server/` is Express on Node 24, which runs the `.ts` files directly. Uploaded images go to `data/files/`.
- The database is Postgres (`server/db.ts`). With `DATABASE_URL` the server uses that database. Without it, local development and tests run PGlite, the Postgres engine in-process: data in `data/pg/`, no database server to install.
- Schema changes are numbered steps in `server/db.ts`, applied once each at start. Add a new step; never edit a released one.
- Each board is a Yjs document. `server/collab.ts` serves it over WebSocket (`/collab/<boardId>`, session cookie required).
- Storage is an append-only log of small changes plus checkpoints (`server/history.ts`): nothing is overwritten. The time machine can show any editing session. Every change is kept for 30 days, then one point per hour for 6 months, then one per day.
- Typed text is shared text (Yjs `Y.Text`), so two people typing in one box keep both edits. Others see a colored outline and name on what you are typing in.
- Sharing: owner, team members (edit), people with a role (edit, comment, view) and anyone in the workspace with the link (a role, or no access). The server drops board changes from viewers and commenters and checks roles on every API and MCP call.
- Inbox: mentions, replies, comments on cards you follow, card assignments and shares.
- Drive: copies (PNG + JSON) of each board go to the owner's own Drive, at most every 10 minutes while it changes. The PNG comes from a headless Chrome (`CHROME_PATH`) that runs the app's own exporter. Sharing can also send a view-only Drive copy.
- MCP tools edit the same live document on the server, so Claude's changes appear at once in open tabs.
- `web/src/engine/` is the canvas: HTML and SVG objects, pan and zoom, selection, snapping, connectors, presence cursors, undo per user.
- `shared/` holds the object model (Whimsical's palette and font scale), connector routing, Mermaid/Excalidraw conversion and the mind map layout. Browser, server and tests use the same code.
- Mermaid needs a DOM to lay out, so Claude's Mermaid requests wait in the board document; the open tab of the present user with the lowest client id converts them.

## Board controls

Shortcuts follow Whimsical. The three icons at the top of the toolbar switch between Diagram (Q), Wireframe (W) and Task mode.
- Shapes (Diagram mode): R rectangle, U pill, O oval, D diamond, P parallelogram, G triangle, F hexagon, Y cylinder, J cloud, V star, L line, B bracket, A annotation, S last shape, E table.
- Tools: N sticky note, M mind map, C connector, T text, X icon, K link, H marker, ⇧H highlighter, . section, I image, ⌥⌘M comment, Space-drag pans.
- Edit: Esc deselects, Enter edits, ⌘Z/⇧⌘Z undo/redo, ⌘D duplicate, ⌥-drag copies, ] and [ change the order, ⇧⌘L locks, = - 0 1 2 zoom, ⇧⌘E export.
- ⌥ + arrow on a shape or sticky note adds the next one (or connects to the object already in that direction). A click on a hover dot does the same; dragging a dot draws a connector.
- Mind map: Tab child, Enter sibling, ⌘Enter sibling above, ⌥Enter parent, ⌘/ collapse, arrows move, typing edits, ⌫ deletes the branch.
- Table: arrows and Tab move between cells, typing replaces the cell, Enter edits, Tab past the last cell adds a row.
- With one object selected, M adds a comment on it.
- Wireframe mode: E components (25 kinds), F frame, A annotation, B button, L or D line, G image, O circle, P input, R rectangle, V avatar. Frames: Plain, Window, iPhone, Android, Tablet, Watch.
- Wireframe components: the context bar sets style, size, state (normal, focused, error, disabled, selected), label, value, icon and color. Checkbox, radio and tab lists have one item per line; "* " marks the checked or selected item.
- Task mode: A card, S stack, double-click the board for a new card, ⌘Enter opens the selected card. Cards have sizes XS to L, a color, an assignee, tags and a notification bell. Drag a card into a stack to add it at that place; drag it out to take it out. Deleting a stack deletes its cards.
- An open card shows its title, description, backlinks (link cards on any board that point to it), discussion threads, assignee, tags, color, stack and activity. Its URL (`?task=<id>`) opens it directly.
- Frames move the components on their screen with them. The context bar changes the device, rotates the frame, and shows the status bar and keyboard.

Paste or drop images and `.excalidraw` / `.mmd` files on the board.
Right-click for Copy as PNG, Copy as Mermaid, Export and more.
Double-click an image to crop it. Drag a mind map node onto another node to move its branch.
Top right: Present (sections are slides), Time machine (one version per editing session; preview, restore, fork), Export, Comments.
Insert menu: Timer and Voting for workshops. Board menu: Color theme, Save as template.

## Known limits

- Mermaid `classDiagram` and other non-flowchart, non-sequence types arrive as a picture. `@excalidraw/mermaid-to-excalidraw` 2.3.0 cannot read the class diagram DOM of Mermaid 11.14 and later. Older Mermaid works, but it has open HTML/CSS injection advisories, so we do not pin it.
- One server process only: board rooms live in memory. See the `ponytail:` comments for the upgrade path.
- Comments are written only through the server, but a modified client could still write the comments part of the Yjs document directly; validate Yjs updates on the server before opening pragmatic to people you do not trust.
- SVG export embeds HTML (foreignObject): it opens in browsers, not in vector editors.
- The card activity log is written by the browser that made the change, like other board data; a modified client could write false entries.
- Drive copies are tested against a fake Google API only, until a Google OAuth client is set up for this server.
- Votes are hidden in the interface until a session ends, but they are in the board document; a modified client could read them early.

## Roadmap

- Test Google sign-in and Drive copies against real Google.
- Task mode: rich-text card descriptions, email for notifications people miss.
- Docs: comments on selected text.
- App shell: desktop tabs, folder grid and list views.
- Scale: a shared Yjs backend, so more than one server can run.
