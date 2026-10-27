## Diagram mode

The infinite canvas, modelled on Whimsical boards.
The three icons at the top of the toolbar switch between Diagram (Q), Wireframe (W) and Task mode.

Objects:
- Shapes: rectangle, pill, oval, diamond, parallelogram (two directions), trapezoid, triangle, hexagon, cylinder, actor, code, annotation, line, cross, bracket, cloud, star.
- Sticky notes, text, sections, icons (Lucide set), images, link cards, freehand marker and highlighter.
- Mind maps: live trees with horizontal or vertical layout, curvy or angular lines, collapse, drag a node to move its branch.
  Each node can have an icon (⇧X; multicolor, fill or outline) and a solid or dashed line to its parent.
  Keys: Tab child, Enter sibling, ⌘Enter sibling above, ⌥Enter parent, Shift+Enter line break, ⌘⌃] indent, ⌘⌃[ outdent, ⌘/ collapse, ⇧⌘/ fold or unfold all branches below.
  ⌥ and an arrow move the node: out, in, or up and down among its siblings.
  While typing an empty node: Tab and ⇧Tab move it in or out; anything else that ends the typing removes it, unless it has branches or an icon.
  An empty root removes its map, unless the map is all the board has.
- Tables: header row, styles (plain, contrast, striped, none, filled), column widths.
- Styles: 15 Whimsical palette colors, fill / outline / dash / transparent, Whimsical font size steps, alignment.
- Shapes can have an icon left of their text (⇧X) and turn in quarter steps (Rotate; the text stays upright). Icons rotate too.
- Sticky notes show their author; "Hide author" removes it.
- The context bar of a shape matches Whimsical's: edit text, shape, color, style, icon, rotate, duplicate, comment, and ⋯ (the full object menu). Text options appear while typing in it.

Text formatting (shapes, stickies, text and mind map nodes):
- Bold (⌘B), italic (⌘I), underline (⌘U), strikethrough (⇧⌘X).
- Bulleted and numbered lists (type "- " or "1. ", or the list button); Tab and ⇧Tab indent list items.
- Links (⌘K, or the link button): a click on a selected object opens the link, ⌘-click always does.
- @mentions of people in the workspace; the person gets an inbox item.
- The context bar acts on the selected words while typing, and on all of an object's text when the object is only selected.

Connectors:
- Elbow, straight or curved routes that route themselves around the ends.
- Ends bind to objects or to single mind map nodes, or stay free.
- Arrow caps, dashes, labels, and an animated flow.
- New connectors go behind the objects they join, so lines never cover shapes.

Editing:
- Select, multi-select, group, ungroup, ⌘-click to select inside a group.
- Align, distribute, snap to grid, lock, duplicate, ⌥-drag copies.
- Bring to front, bring forward, send backward, send to back (] and [).
- Copy style, paste style, save as default style.
- ⌥ + arrow or a click on a hover dot adds the next connected shape. Q shows or hides the dots.
- Hold ⌥ to measure the distance between objects.
- / opens "All tools".
- Undo and redo per person.

Right-click menu:
- Cut, Copy, Paste, Paste as (plain text, table), Duplicate, Delete, Select all.
- Copy puts readable text on the clipboard for other apps (a mind map as an indented list, a table as cells) and keeps the objects for pragmatic.
  A focused mind map node copies its branch (text and look), and Cut removes only that branch.
- Paste cells from Sheets, Excel or Notion: a table.
  Paste a list (lines with markers such as - or 1., or a list from a notes app): a mind map, or new branches when a mind map node is focused.
  Indented text with no markers (code, JSON) stays text.
- Copy as PNG, PNG without background, PNG light, PNG dark, SVG, Mermaid.
- Copy link to object, copy link to board position.
- Arrange, Align, Group, Wrap in section, Snap to grid, Set as board thumbnail, Add comment, zoom items.

Board extras:
- Templates: Flowchart, Retrospective, Kanban board, User journey, Brainstorm, Org chart, and workspace templates (Save as template).
- Color themes per board, workspace themes, and a workspace default theme.
- Present mode (sections are slides), timer and voting for workshops.
- Paste or drop images, `.excalidraw` files, `.mmd` (Mermaid) files, and `.md` or `.txt` outlines (one mind map per top-level line or heading; a flat list of lines makes one mind map named after the file).
  The Import button next to Export opens the same files.
- Double-click an image to crop it.

Shortcuts: see the "Board controls" section of the README.

Not done:
- Icon categories in the icon picker (search only), and AI "generate ideas" on mind map nodes (ask Claude through MCP instead).
- Rich text in table cells, connector labels and task cards (plain shared text there).
- Mermaid class diagrams and other types that are not flowchart or sequence arrive as a picture (see the README).
- SVG export opens in browsers, not in vector editors.
