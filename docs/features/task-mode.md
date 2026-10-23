## Task mode

Task cards and stacks (kanban columns) on a board.

Cards:
- Sizes XS, S, M, L, a color, an assignee, tags and a notification bell (watch).
- A to add a card, double-click the board for a new card, ⌘Enter opens the selected card.
- Drag a card into a stack at a place, or out of it.

Stacks:
- S to add a stack. Cards in a stack lay out by themselves.
- Deleting a stack deletes its cards.

An open card shows:
- Title and description, both shared text (two people can type at once).
- Backlinks: link cards on any board that point to this card.
- Discussion threads, assignee, tags, color, stack.
- Activity: who created and changed the card.
- Its own URL (`?task=<id>`), and a star.

Notifications: the assignee and the watchers get inbox items (see `collaboration.md`).

Claude: `add_tasks` adds cards to a new or existing stack, `update_task` changes one card.

Not done:
- Rich text in card descriptions (plain shared text now).
- Email when people miss the inbox.
