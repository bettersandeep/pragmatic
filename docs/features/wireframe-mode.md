## Wireframe mode

Low-fidelity UI mockups, in the same board as diagrams.

Frames:
- Devices: Plain, Window, iPhone, Android, Tablet, Watch.
- Status bar and keyboard on or off, portrait or landscape (rotate keeps the layout and stretches wide items).
- Components on a frame's screen move with the frame.

Components (25 kinds):
- button, link, input, textarea, dropdown, checkbox, radio, toggle, slider, progress, stars (rating).
- horizontal tabs, vertical tabs, tag, tooltip, shape (rectangle, ellipse, pill), image, video, avatar, divider, overlay, map, lorem text, block font, annotation.

Each component has:
- Style (fill, outline, dashes), six sizes, a state (normal, focused, error, disabled, selected).
- A label, a value (slider, progress, rating), an icon and a color.
- Checkbox, radio and tab lists have one item per line; "* " marks the checked or selected item.

Shortcuts: E components, F frame, A annotation, B button, L or D line, G image, O circle, P input, R rectangle, V avatar.

Claude: `add_wireframe` draws a frame with components; screens line up to the right and connectors join them.
