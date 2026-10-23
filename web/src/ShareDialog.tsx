import { useEffect, useState } from 'react';
import { copyText } from './clipboard.ts';
import { Link2, Lock, X } from 'lucide-react';
import { api, type Item, type Person, type Role, type Shares } from './api.ts';
import { Avatar, people } from './engine/Comments.tsx';

const ROLE_LABEL: Record<Role, string> = { edit: 'Can edit', comment: 'Can comment', view: 'Can view', owner: 'Owner' };
const LINK_LABEL: Record<Item['link_access'], string> = { none: 'No access', view: 'Can view', comment: 'Can comment', edit: 'Can edit' };

// Sharing on demand: the owner or an editor picks each person's role, and the role for anyone with the link.
export function ShareDialog({ id, onClose, onToast }: { id: string; onClose: () => void; onToast: (m: string) => void }) {
  const [s, setS] = useState<Shares | null>(null);
  const [email, setEmail] = useState(''), [role, setRole] = useState<Exclude<Role, 'owner'>>('edit');
  const [all, setAll] = useState<Person[]>([]);
  const [error, setError] = useState('');
  const [drive, setDrive] = useState<{ connected: boolean; available: boolean } | null>(null), [withDrive, setWithDrive] = useState(false);
  const [driveLink, setDriveLink] = useState<string | null>(null), [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const [inviteNeeded, setInviteNeeded] = useState<string | null>(null);
  useEffect(() => { api.shares(id).then(setS, (e) => setError(e.message)); people().then(setAll); api.drive().then(setDrive, () => {}); }, [id]);
  const manage = s?.role === 'owner' || s?.role === 'edit';
  const run = (p: Promise<Shares>) => p.then((r) => { setS(r); setError(''); }, (e) => setError(e.message));
  const invite = () => {
    if (!email.trim()) return;
    const who = email.trim();
    run(api.share(id, who, role, withDrive && !!drive?.connected).then((r) => {
      setDriveLink(r.drive_link ?? null);
      // No account yet (passwords): an admin gets a link to pass on, copied; anyone else is told to ask an admin.
      if (r.invite_link) { setInviteLink({ email: who, url: r.invite_link }); copyText(r.invite_link).catch(() => {}); }
      setInviteNeeded(r.invite_needed ? who : null);
      return r;
    })).then(() => setEmail(''));
  };
  const taken = new Set([s?.owner.email, ...(s?.members.map((m) => m.email) ?? [])]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal share-modal" role="dialog" aria-label="Share board">
        <div className="share-head"><h3>Share board</h3><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
        {manage && (
          <div className="share-invite">
            <input list="share-people" type="email" placeholder="Add people by email" value={email} aria-label="Email"
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && invite()} />
            <datalist id="share-people">{all.filter((p) => !taken.has(p.email)).map((p) => <option key={p.id} value={p.email}>{p.name}</option>)}</datalist>
            <select value={role} aria-label="Role for new people" onChange={(e) => setRole(e.target.value as typeof role)}>
              {(['edit', 'comment', 'view'] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className="btn primary" disabled={!email.trim()} onClick={invite}>Invite</button>
          </div>
        )}
        {manage && drive?.available && (
          drive.connected
            ? <label className="share-drive"><input type="checkbox" checked={withDrive} onChange={(e) => setWithDrive(e.target.checked)} /> Also share a view-only copy in my Google Drive</label>
            : <p className="share-drive muted">To share a Drive copy too, <a href={`/auth/drive?next=${encodeURIComponent(location.pathname)}`}>connect Google Drive</a>.</p>
        )}
        {driveLink && <p className="share-drive">Drive copy shared: <a href={driveLink} target="_blank" rel="noopener">open in Drive</a></p>}
        {inviteLink && <p className="share-drive">{inviteLink.email} has no account yet. Send them this invite link (copied): <code>{inviteLink.url}</code></p>}
        {inviteNeeded && <p className="share-drive">{inviteNeeded} has no account yet. Ask an admin to send them an invite link (Settings, People). The board is shared once they sign in.</p>}
        {error && <p className="error">{error}</p>}
        {s && (
          <ul className="share-list">
            <li><Avatar p={s.owner} size={28} /><span className="share-who"><strong>{s.owner.name}</strong><span className="muted">{s.owner.email}</span></span><span className="muted">Owner</span></li>
            {s.scope === 'team' && <li><span className="share-icon"><Lock size={15} /></span><span className="share-who"><strong>Everyone in Team</strong><span className="muted">The board is in the team space</span></span><span className="muted">Can edit</span></li>}
            {s.members.map((m) => (
              <li key={m.user_id}>
                <Avatar p={m} size={28} />
                <span className="share-who"><strong>{m.name}</strong><span className="muted">{m.email}</span></span>
                {manage
                  ? <select value={m.role} aria-label={`Role for ${m.name}`} onChange={(e) => run(api.share(id, m.email, e.target.value as Role | 'none'))}>
                      {(['edit', 'comment', 'view'] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      <option value="none">Remove</option>
                    </select>
                  : <span className="muted">{ROLE_LABEL[m.role]}</span>}
              </li>
            ))}
            <li>
              <span className="share-icon"><Link2 size={15} /></span>
              <span className="share-who"><strong>Anyone in the workspace with the link</strong></span>
              {manage
                ? <select value={s.link_access} aria-label="Link access" onChange={(e) => run(api.linkAccess(id, e.target.value as Item['link_access']))}>
                    {(Object.keys(LINK_LABEL) as Item['link_access'][]).map((a) => <option key={a} value={a}>{LINK_LABEL[a]}</option>)}
                  </select>
                : <span className="muted">{LINK_LABEL[s.link_access]}</span>}
            </li>
          </ul>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => copyText(`${location.origin}/b/${id}`).then(() => onToast('Link copied'))}><Link2 size={15} /> Copy link</button>
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
