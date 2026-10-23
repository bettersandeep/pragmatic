import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { objectJSON, objectsOf } from '../../../shared/doc.ts';
import { ySyncPluginKey } from 'y-prosemirror';
import { commentsOf, readThreads, type Thread } from '../../../shared/comments.ts';
import { settingsOf, votesOf } from '../../../shared/themes.ts';
import { jsonEntries, type BoardObject } from '../../../shared/model.ts';
import type { Pt } from '../../../shared/route.ts';
import { PEER_COLORS } from './theme.ts';

// Origin of this tab's own edits; only these are undoable here.
export const LOCAL = { local: true };

export type PeerUser = { id: string; name: string; color: string; picture?: string | null };
export type Peer = { clientId: number; user: PeerUser; cursor?: Pt | null; selection?: string[]; editing?: string | null };

const colorFor = (id: string) => PEER_COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEER_COLORS.length];

// `hidden`: a server-side render that must not show up as a person on the board.
export function useBoard(boardId: string, me: { id: string; name: string; picture: string | null }, hidden = false) {
  const { doc, provider, undo } = useMemo(() => {
    const doc = new Y.Doc();
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`;
    const provider = new WebsocketProvider(url, boardId, doc, { maxBackoffTime: 5000 });
    // Rich text typing (y-prosemirror's origin) is undone with the board, like every other edit of this tab.
    const undo = new Y.UndoManager(objectsOf(doc), { trackedOrigins: new Set([LOCAL, ySyncPluginKey]), captureTimeout: 400 });
    return { doc, provider, undo };
  }, [boardId]);

  const [objects, setObjects] = useState<BoardObject[]>([]);
  const [synced, setSynced] = useState(false);
  const [online, setOnline] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [threads, setThreads] = useState<Thread[]>([]);
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [votes, setVotes] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    // Rebuild only objects that changed, so unchanged ones keep identity and memoized views skip work.
    const map = objectsOf(doc), cache = new Map<string, BoardObject>(), dirty = new Set<string>();
    let frame = 0, full = true;
    const flush = () => {
      if (full) { cache.clear(); for (const [id, m] of map) cache.set(id, objectJSON(m)); }
      else for (const id of dirty) { const m = map.get(id); if (m) cache.set(id, objectJSON(m)); else cache.delete(id); }
      full = false;
      dirty.clear();
      setObjects([...cache.values()].sort((a, b) => a.z - b.z));
    };
    const refresh = (events: Y.YEvent<Y.Map<unknown>>[]) => {
      for (const e of events) {
        if (e.target === map) e.changes.keys.forEach((_, k) => dirty.add(k));
        else dirty.add(e.path[0] as string);
      }
      cancelAnimationFrame(frame);
      // Own edits show at once (an editor opened by the same key press must see them); remote edits batch per frame.
      if (events[0]?.transaction.local) flush();
      else frame = requestAnimationFrame(flush);
    };
    map.observeDeep(refresh as never);
    const comments = commentsOf(doc), onComments = () => setThreads(readThreads(doc));
    comments.observe(onComments);
    const settingsMap = settingsOf(doc), onSettings = () => setSettings(Object.fromEntries(jsonEntries(settingsMap.entries())));
    settingsMap.observe(onSettings);
    const votesMap = votesOf(doc), onVotes = () => setVotes(Object.fromEntries(jsonEntries(votesMap.entries())));
    votesMap.observe(onVotes);
    const onSync = (s: boolean) => { setSynced(s); if (s) { full = true; flush(); onComments(); onSettings(); onVotes(); } };
    const onStatus = ({ status }: { status: string }) => setOnline(status === 'connected');
    provider.on('sync', onSync);
    provider.on('status', onStatus);
    // The socket can connect and sync before this effect runs; pick up the current state.
    setOnline(provider.wsconnected);
    if (provider.synced) onSync(true);

    const aw = provider.awareness;
    if (!hidden) aw.setLocalStateField('user', { id: me.id, name: me.name, picture: me.picture, color: colorFor(me.id) } satisfies PeerUser);
    const onPeers = () => setPeers([...aw.getStates()]
      .filter(([id, s]) => id !== aw.clientID && s.user)
      .map(([clientId, s]) => ({ clientId, ...s } as Peer)));
    // Deferred: editors (BlockNote) set presence while React renders them, and a state update then is not allowed.
    const onChange = () => queueMicrotask(onPeers);
    aw.on('change', onChange);

    const onStack = () => setHistory({ undo: undo.canUndo(), redo: undo.canRedo() });
    undo.on('stack-item-added', onStack);
    undo.on('stack-item-popped', onStack);
    undo.on('stack-cleared', onStack);

    return () => {
      cancelAnimationFrame(frame);
      map.unobserveDeep(refresh as never);
      comments.unobserve(onComments);
      settingsMap.unobserve(onSettings);
      votesMap.unobserve(onVotes);
      aw.off('change', onChange);
      undo.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, [doc, provider, undo, me.id, me.name, me.picture]);

  return { doc, provider, awareness: provider.awareness, undo, objects, synced, online, peers, history, threads, settings, votes, me, myColor: colorFor(me.id) };
}

export type Board = ReturnType<typeof useBoard>;
