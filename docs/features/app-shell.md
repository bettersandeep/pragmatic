## App shell

The frame around boards and docs: sidebar, home page, search and settings.

Sign-in:
- Personal mode (`AUTH=local`, the default): no sign-in, one person, this machine only.
- Team modes: OpenID Connect (`AUTH=oidc`), accounts with passwords and invite links (`AUTH=password`), Google (`AUTH=google`); `ALLOWED_EMAIL_DOMAINS` limits who can sign in.
- Admins manage people in Settings: invite, reset a password, make admin, remove access.
- Local development can use `/auth/dev` from 127.0.0.1 when `PRAGMATIC_DEV_LOGIN` is set.

Sidebar:
- Inbox with an unread count.
- Recent.
- Starred: boards, docs and single task cards.
- Private and Team sections, each with a folder tree. Items move between folders by drag and drop.
- A shared section lists items that other people shared with you.
- The "+" of a section opens a menu: New board, New doc, New folder, From template.
- Trash, Settings & Claude, the signed-in person, sign out.
- Search (title and the text on boards and docs).

Home page (Recent):
- Cards of the most recently changed boards and docs.
- A board shows its thumbnail when someone set one ("Set as board thumbnail" in the right-click menu).

Title bar of a board or doc:
- Breadcrumb with the folder and an editable title.
- Star, people who are here now, the role pill (View only, Can comment), Share, and the board menu.

Settings:
- Account.
- Google Drive: connect or disconnect.
- Connect Claude: Claude Desktop extension download, Claude Code command, connected apps (disconnect each), and personal tokens for clients without OAuth.

Not done:
- Desktop tabs, grid and list views of folders, multi-select in the sidebar.
