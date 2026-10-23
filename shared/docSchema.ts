// The custom doc blocks. The web editor and the server converter must share these configs, or the server
// cannot read docs that use them.
export const embedConfig = { type: 'embed', propSchema: { itemId: { default: '' } }, content: 'none' } as const;
export const CALLOUT_COLORS = ['blue', 'yellow', 'green', 'red'] as const;
export const calloutConfig = { type: 'callout', propSchema: { color: { default: 'blue', values: CALLOUT_COLORS } }, content: 'inline' } as const;
