## Claude

pragmatic is an MCP server, so Claude can read and edit boards and docs.
Claude connects with OAuth (pragmatic's own sign-in, then a consent page), so pragmatic never sees a Claude login.
"Sign in with Claude" is not allowed for third-party apps, so the MCP connection is the integration.

Ways to connect (Settings & Claude shows each one):
- Claude Desktop: download the extension (`/pragmatic.mcpb`), open it, paste the MCP address. No Node and no Claude Code needed.
- Claude Code: `claude mcp add --transport http pragmatic <server>/mcp`, then `/mcp` and Authenticate.
- Any other MCP client with OAuth, or a personal token (`pgm_...`) for clients without OAuth.
- Claude Desktop "custom connectors" connect from Anthropic's cloud, so they work only when the server is reachable from the internet.

What Claude can do (29 tools):
- Find and create: `list_items`, `search`, `create_board`, `create_folder`, `create_doc`, `list_templates`.
- Read: `read_board`, `read_doc`, `read_comments`, `export_board` (PNG it can look at, JSON or Mermaid).
- Draw: `add_objects`, `add_mermaid`, `add_mindmap`, `add_table`, `add_wireframe`, `add_tasks`, `add_link`, `add_image`, `import_excalidraw`, `search_icons`.
- Change: `update_objects`, `delete_objects`, `edit_mindmap` (add, rename, delete, color, icon, indent, outdent), `update_table`, `update_task`, `write_doc`.
- Claude reads and writes board text as plain text. Changing it keeps the formatting of the words it does not touch.
- Share and comment: `share_board`, `add_comment`, `copy_to_drive`.

Typical requests:
- "Draw our login flow as a flowchart on a new pragmatic board."
- Paste a screenshot of a diagram: "Rebuild this in pragmatic." Claude reads the picture and draws editable shapes.
- Import from Whimsical: Claude reads with the Whimsical MCP tools and rebuilds the board here.

Claude's edits appear at once in open tabs and are credited in the history.
Claude needs the same role as a person: edit to draw, comment to comment.

Desktop app (`desktop/`):
- An Electron window with the board, and a panel (⇧⌘K) that runs your own Claude Code in a terminal.
- Works alone: the built-in server runs pragmatic in the app for one person. Settings switches to a team server.
- Settings turns the Claude panel off for people without Claude Code.
- "Connect Claude to pragmatic" adds the MCP server to Claude Code.
- macOS only, unsigned dmg (testers clear the quarantine flag once); Google sign-in inside the app is not tested yet.
