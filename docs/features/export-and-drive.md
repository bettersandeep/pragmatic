## Export and Google Drive

Export (⇧⌘E, or the export icon):
- PNG at 1x to 4x, light or dark, with or without background.
- SVG.
- JSON (all objects and comments).
- Mermaid text of a flowchart.
- The right-click menu copies a selection as PNG, SVG or Mermaid to the clipboard.

Server pictures:
- The server draws the same PNG as the browser (headless Chrome opens the board), for Drive copies, doc embeds and Claude's `export_board`.

Google Drive:
- Each person connects their own Drive once (Settings). pragmatic sees only the files it made (`drive.file` scope).
- Automatic copies go to the owner's "pragmatic" folder: a PNG and a JSON per board, Markdown per doc.
- Copies are made at most every 10 minutes while a board changes, and soon after the last person leaves.
- The same files are updated, so Drive keeps earlier versions as revisions.
- "Save copy to Google Drive" in the board or doc menu makes a copy at once.
- Sharing can also give the other person a view-only Drive copy.

Not done:
- Tested against a fake Google API only, until a Google OAuth client is set up for the server.
- pragmatic cannot import a Drive copy back.
