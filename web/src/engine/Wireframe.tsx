import { memo } from 'react';
import { BatteryFull, ChevronDown, Signal, Star, Wifi } from 'lucide-react';
import { DEVICES, frameScreen, type FrameObj, type WfObj, type WfSize } from '../../../shared/model.ts';
import { isLight } from '../../../shared/themes.ts';
import { Glyph } from './IconView.tsx';
import { EditText } from './ObjectView.tsx';
import { CANVAS, activePalette, mix, type Theme } from './theme.ts';

// Components whose text the user types in place.
export const WF_TEXT = new Set<string>(['button', 'link', 'input', 'textarea', 'dropdown', 'checkbox', 'radio', 'htabs', 'vtabs', 'tag', 'tooltip', 'annotation']);
// Components that can show a label above them, and those whose value is a position from 0 to 1.
export const WF_LABELLED = new Set<string>(['input', 'textarea', 'dropdown', 'checkbox', 'radio', 'slider', 'progress', 'stars']);
export const WF_POS = new Set<string>(['slider', 'progress', 'stars']);
export const WF_ICON = new Set<string>(['button', 'link', 'input', 'tag', 'shape', 'image', 'video', 'avatar']);

export const WF_FONT: Record<WfSize, number> = { xs: 12, s: 14, m: 16, l0: 18, xl: 21, xxl: 24 };
// Text color on a solid fill: dark on light fills (white, yellow, the default color in dark mode), white otherwise.
const onFill = (hex: string) => (isLight(hex) ? '#1F2A35' : '#FFFFFF');
const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';

// Items of list components: one per line, "* " marks the selected or checked item.
export const wfItems = (text: string) => text.split('\n').filter((l) => l.trim()).map((l) => ({ on: /^\*\s/.test(l), label: l.replace(/^\*\s/, '') }));

type Props = { o: WfObj; layer: number; theme: Theme; editing: boolean; onCommit: (t: string) => void; pv?: number };

export const WfView = memo(function WfView({ o, layer, theme, editing, onCommit }: Props) {
  const t = CANVAS[theme], pal = activePalette();
  const c = pal[o.color], base = o.color === 'default' || o.color === 'white' ? t.text : c.base;
  const line = theme === 'light' ? '#C4CFDA' : '#3E4651', soft = theme === 'light' ? '#F2F5F7' : '#1B2027', muted = t.muted;
  const fs = WF_FONT[o.size ?? 'm'];
  const disabled = o.state === 'disabled';
  const tint = theme === 'light' ? c.fill : mix(t.bg, c.base, 0.22);
  const edit = (value: string, single = true) => <EditText value={value} bind={{ id: o.id, key: 'text' }} onCommit={onCommit} single={single} autoWidth={single} selectAll />;
  const text = (value: string, single = true) => (editing ? edit(value, single) : value);
  const labelEl = o.label ? <div className="wf-label" style={{ fontSize: fs - 2 }}>{o.label}</div> : null;
  const field = (children: React.ReactNode, extra: React.CSSProperties = {}) => (
    <div className="wf-field" style={{
      borderColor: o.state === 'focused' ? pal.blue.base : o.state === 'error' ? pal.red.base : line,
      borderWidth: o.state === 'focused' || o.state === 'error' ? 2 : 1, background: disabled ? soft : t.bg, color: disabled ? muted : t.text, fontSize: fs, ...extra,
    }}>{children}</div>
  );

  let body: React.ReactNode;
  switch (o.kind) {
    case 'button': {
      const fill = o.deco === 'fill';
      body = (
        <div className="wf-button" style={{ background: fill ? base : 'transparent', borderColor: base, color: fill ? onFill(base) : base, fontSize: fs, borderStyle: o.deco === 'dashes' ? 'dashed' : 'solid' }}>
          {o.icon && <Glyph name={o.icon} size={fs + 2} color="currentColor" />}{text(o.text)}
        </div>
      );
      break;
    }
    case 'link': body = <div className="wf-link" style={{ color: base, fontSize: fs }}>{o.icon && <Glyph name={o.icon} size={fs} color="currentColor" />}<u>{text(o.text)}</u></div>; break;
    case 'input':
      body = <>{labelEl}{field(<>{o.icon && <Glyph name={o.icon} size={fs + 2} color={muted} />}<span className="wf-ph">{text(o.text)}</span></>)}</>;
      break;
    case 'textarea':
      body = <>{labelEl}{field(<span className="wf-ph top">{text(o.text, false)}</span>, { alignItems: 'flex-start', paddingTop: 8 })}</>;
      break;
    case 'dropdown':
      body = <>{labelEl}{field(<><span className="wf-ph">{text(o.text)}</span><ChevronDown size={fs + 2} color={muted} /></>, o.state === 'normal' && o.deco === 'fill' ? { background: soft } : {})}</>;
      break;
    case 'checkbox': case 'radio': {
      const items = wfItems(o.text);
      body = (
        <>{labelEl}<div className="wf-list" style={{ fontSize: fs }}>
          {editing ? edit(o.text, false) : items.map((it, i) => (
            <div key={i} className="wf-item">
              <span className={`wf-check ${o.kind}`} style={{ borderColor: it.on ? base : line, background: it.on && o.kind === 'checkbox' ? base : 'transparent' }}>
                {it.on && (o.kind === 'checkbox' ? <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 6.5 5 9l5-6" fill="none" stroke={onFill(base)} strokeWidth="2" strokeLinecap="round" /></svg> : <span className="dot" style={{ background: base }} />)}
              </span>
              {it.label}
            </div>
          ))}
        </div></>
      );
      break;
    }
    case 'toggle': {
      const on = o.state === 'selected';
      body = <div className="wf-toggle" style={{ background: on ? base : line }}><span style={on ? { right: 2 } : { left: 2 }} /></div>;
      break;
    }
    case 'slider': {
      const p = o.pos ?? 0.5;
      body = <>{labelEl}<div className="wf-slider"><div className="track" style={{ background: line }}><div style={{ width: `${p * 100}%`, background: base }} /></div><span className="knob" style={{ left: `${p * 100}%`, borderColor: base }} /></div></>;
      break;
    }
    case 'progress':
      body = <>{labelEl}<div className="wf-progress" style={{ background: line }}><div style={{ width: `${(o.pos ?? 0.5) * 100}%`, background: base }} /></div></>;
      break;
    case 'stars': {
      const n = Math.round((o.pos ?? 0.6) * 5), sz = Math.min(o.h - (o.label ? 20 : 0), o.w / 5) - 2;
      body = <>{labelEl}<div className="wf-stars">{[0, 1, 2, 3, 4].map((i) => <Star key={i} size={sz} color={i < n ? base : line} fill={i < n ? base : 'none'} strokeWidth={1.6} />)}</div></>;
      break;
    }
    case 'htabs': case 'vtabs': {
      const items = wfItems(o.text);
      body = editing ? edit(o.text, false) : (
        <div className={`wf-tabs ${o.kind}`} style={{ fontSize: fs, borderColor: line }}>
          {items.map((it, i) => (
            <div key={i} className={`wf-tab ${it.on ? 'on' : ''}`} style={it.on ? (o.kind === 'htabs' ? { color: base, borderColor: base } : { color: base, background: tint }) : { color: t.text }}>{it.label}</div>
          ))}
        </div>
      );
      break;
    }
    case 'tag':
      body = <div className="wf-tag" style={{ background: o.deco === 'fill' ? base : tint, color: o.deco === 'fill' ? onFill(base) : base, fontSize: fs - 2 }}>{o.icon && <Glyph name={o.icon} size={fs - 2} color="currentColor" />}{text(o.text)}</div>;
      break;
    case 'tooltip':
      body = <div className={`wf-tooltip arrow-${o.arrow ?? 'bottom'}`} style={{ background: o.deco === 'outline' ? t.bg : base, color: o.deco === 'outline' ? t.text : onFill(base), borderColor: base, fontSize: fs - 2, ['--tip' as string]: o.deco === 'outline' ? t.bg : base }}>{text(o.text)}</div>;
      break;
    case 'shape': case 'image': case 'video': case 'avatar': {
      const round = o.kind === 'avatar' || o.shapeType === 'ellipse' ? '50%' : o.shapeType === 'pill' ? `${o.h / 2}px` : '4px';
      const solid = o.deco === 'fill';
      body = (
        <div className="wf-shape" style={{ borderRadius: round, background: solid ? tint : 'transparent', borderColor: base, borderStyle: o.deco === 'dashes' ? 'dashed' : 'solid' }}>
          {o.icon && <Glyph name={o.icon} size={Math.max(14, Math.min(o.w, o.h) * 0.36)} color={base} strokeWidth={1.5} />}
        </div>
      );
      break;
    }
    case 'divider': {
      const vertical = o.h > o.w;
      body = <div className="wf-divider" style={{ [vertical ? 'borderLeft' : 'borderTop']: `${o.size === 'xs' ? 1 : 2}px ${o.deco === 'dashes' ? 'dashed' : 'solid'} ${o.color === 'light-gray' ? line : base}`, ...(vertical ? { width: 0, height: '100%', margin: '0 auto' } : { height: 0, width: '100%', marginTop: o.h / 2 }) }} />;
      break;
    }
    case 'overlay': body = <div className="wf-overlay" style={{ background: base, opacity: 0.45 }} />; break;
    case 'map':
      body = (
        <svg className="wf-map" width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 280 180">
          <rect width="280" height="180" fill={theme === 'light' ? '#EEF1EC' : '#20262B'} />
          <path d="M0 60 L280 40 M0 130 L280 150 M70 0 L90 180 M190 0 L170 180 M0 0 L280 180" stroke={theme === 'light' ? '#FFFFFF' : '#2E363D'} strokeWidth="9" fill="none" />
          <path d="M130 20 C160 60 110 100 150 170" stroke={theme === 'light' ? '#C9DCEF' : '#24394F'} strokeWidth="12" fill="none" />
          <circle cx="182" cy="82" r="8" fill={pal.red.base} />
        </svg>
      );
      break;
    case 'lorem': body = <div className="wf-lorem" style={{ color: muted, fontSize: fs - 2 }}>{LOREM}</div>; break;
    case 'blockfont':
      body = <div className="wf-blockfont">{[0.9, 0.6].map((f, i) => <span key={i} style={{ width: `${f * 100}%`, background: line }} />)}</div>;
      break;
    case 'annotation':
      body = <div className="wf-annotation" style={{ background: o.deco === 'outline' ? 'transparent' : base, borderColor: base, color: o.deco === 'outline' ? base : onFill(base), fontSize: Math.min(o.h * 0.5, fs) }}>{text(o.text)}</div>;
      break;
  }
  return (
    <div className={`obj wf wf-k-${o.kind} ${disabled ? 'disabled' : ''}`} data-id={o.id} style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer, color: t.text }}>
      {body}
    </div>
  );
});

// Device frames: the outer chrome is drawn; the screen is where components go.
export const FrameView = memo(function FrameView({ o: f, layer, theme, editing, onCommit }: Omit<Props, 'o'> & { o: FrameObj }) {
  const t = CANVAS[theme], d = DEVICES[f.device];
  const screen = frameScreen({ ...f, x: 0, y: 0 });
  const bezel = theme === 'light' ? '#2B323B' : '#3A424C', screenBg = theme === 'light' ? '#FFFFFF' : '#161A20', line = theme === 'light' ? '#C4CFDA' : '#3E4651';
  const phone = f.device === 'iphone' || f.device === 'android' || f.device === 'tablet' || f.device === 'watch';
  const radius = f.device === 'iphone' ? 54 : f.device === 'watch' ? 52 : f.device === 'android' ? 34 : f.device === 'tablet' ? 32 : f.device === 'window' ? 10 : 4;
  const [it, , , il] = d.inset;
  const statusH = f.statusBar ? d.status : 0;
  return (
    <div className={`obj frame-obj device-${f.device}`} data-id={f.id} style={{ left: f.x, top: f.y, width: f.w, height: f.h, zIndex: layer }}>
      <div className="frame-title" style={{ color: t.muted }}>{editing ? <EditText value={f.title} onCommit={onCommit} single /> : f.title || d.label}</div>
      <div className="frame-body" style={{ borderRadius: radius, background: phone ? bezel : screenBg, borderColor: line }}>
        {f.device === 'window' && <div className="frame-titlebar" style={{ background: theme === 'light' ? '#EEF1F4' : '#232830', borderColor: line }}><i /><i /><i /></div>}
        {phone && <div className="frame-screen" style={{ left: il, top: it, right: il, bottom: it, borderRadius: Math.max(4, radius - il), background: screenBg }} />}
        {f.statusBar && d.status > 0 && (
          <div className="frame-status" style={{ left: il, right: il, top: it, height: statusH, color: t.text }}>
            <span>9:41</span>
            {f.device === 'iphone' && <span className="island" />}
            <span className="icons"><Signal size={13} /><Wifi size={13} />{f.device !== 'watch' && <BatteryFull size={16} />}</span>
          </div>
        )}
        {f.keyboard && (
          <div className="frame-keyboard" style={{ left: il, right: il, bottom: d.inset[2], height: Math.min(260, screen.h * 0.4), background: theme === 'light' ? '#D7DBE1' : '#262C34', borderBottomLeftRadius: Math.max(4, radius - il), borderBottomRightRadius: Math.max(4, radius - il) }}>
            {[10, 9, 7].map((n, r) => <div key={r} className="kb-row">{Array.from({ length: n }, (_, i) => <span key={i} style={{ background: theme === 'light' ? '#fff' : '#3A424C' }} />)}</div>)}
            <div className="kb-row"><span className="space" style={{ background: theme === 'light' ? '#fff' : '#3A424C' }} /></div>
          </div>
        )}
        {f.device === 'android' && <div className="frame-nav" style={{ bottom: d.inset[2] + 6 }}><span /></div>}
        {f.device === 'watch' && <span className="frame-crown" style={{ background: bezel }} />}
      </div>
    </div>
  );
});
