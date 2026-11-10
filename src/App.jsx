import { useEffect, useMemo, useState } from 'react';
import { sb } from './supabase';
import { embed, suggest } from './ai';

async function shrink(file, max, q) {
  const b = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(b.width, b.height));
  const c = document.createElement('canvas');
  c.width = Math.round(b.width * s); c.height = Math.round(b.height * s);
  c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}

function Auth() {
  const [e, setE] = useState(''), [p, setP] = useState(''), [m, setM] = useState('');
  const go = async up => {
    const { error } = up ? await sb.auth.signUp({ email: e, password: p })
                         : await sb.auth.signInWithPassword({ email: e, password: p });
    setM(error ? error.message : up ? 'Check your email to confirm, then sign in.' : '');
  };
  return (
    <main className="auth">
      <h1 className="mega">LIKE<br />BUTTER</h1>
      <p className="tag">Your anime-pics vault. Private. Permanent.</p>
      <div className="box">
        <input placeholder="email" value={e} onChange={x => setE(x.target.value)} />
        <input placeholder="password" type="password" value={p} onChange={x => setP(x.target.value)} />
        <div className="row"><button onClick={() => go(false)}>SIGN IN</button>
          <button className="alt" onClick={() => go(true)}>SIGN UP</button></div>
        <p>{m}</p>
      </div>
    </main>
  );
}

function Vault({ user }) {
  const [tab, setTab] = useState('library');
  const [folders, setFolders] = useState([]), [images, setImages] = useState([]);
  const [fid, setFid] = useState('all'), [urls, setUrls] = useState({});
  const [status, setStatus] = useState(''), [sel, setSel] = useState(new Set());
  const [pick, setPick] = useState(false), [strict, setStrict] = useState(0.78);
  const [limit, setLimit] = useState(200), [view, setView] = useState(null), [name, setName] = useState('');

  const load = async () => {
    const [f, i] = await Promise.all([
      sb.from('folders').select('*').order('name'),
      sb.from('images').select('id,folder_id,path,thumb_path,name,created_at').order('created_at', { ascending: false }).limit(5000)]);
    setFolders(f.data || []); setImages(i.data || []);
  };
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => images.filter(i =>
    tab === 'inbox' ? !i.folder_id : fid === 'all' || i.folder_id === fid).slice(0, limit), [images, tab, fid, limit]);

  useEffect(() => {
    const need = shown.filter(i => !urls[i.id]);
    if (!need.length) return;
    sb.storage.from('vault').createSignedUrls(need.map(i => i.thumb_path), 3600).then(({ data }) => {
      if (data) setUrls(u => { const n = { ...u }; data.forEach((d, k) => n[need[k].id] = d.signedUrl); return n; });
    });
  }, [shown]);

  const count = id => images.filter(i => i.folder_id === id).length;
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const addFolder = async () => { if (!name.trim()) return; await sb.from('folders').insert({ name: name.trim() }); setName(''); load(); };
  const delFolder = async id => { if (confirm('Delete folder? Its images move to Inbox.')) { await sb.from('folders').delete().eq('id', id); setFid('all'); load(); } };
  const move = async (ids, folder_id) => { await sb.from('images').update({ folder_id }).in('id', ids); setSel(new Set()); setPick(false); load(); };
  const del = async ids => {
    if (!confirm(`Delete ${ids.length} image(s) forever?`)) return;
    const rows = images.filter(i => ids.includes(i.id));
    await sb.storage.from('vault').remove(rows.flatMap(r => [r.path, r.thumb_path]));
    await sb.from('images').delete().in('id', ids); setSel(new Set()); load();
  };
  const known = async () => (await sb.from('images').select('folder_id,embedding').not('folder_id', 'is', null).limit(1500)).data || [];

  async function upload(e) {
    const files = [...e.target.files], ex = await known();
    for (let i = 0; i < files.length; i++) {
      setStatus(`Saving ${i + 1}/${files.length}…`);
      const id = crypto.randomUUID(), base = `${user.id}/${id}`;
      const full = files[i], th = await shrink(files[i], 320, 0.8);
      const ext = (files[i].name.split('.').pop() || 'jpg').toLowerCase();
      let vec = null, folder_id = null;
      try {
        vec = await embed(th, p => p.status === 'progress' && setStatus(`Downloading AI brain ${Math.round(p.progress)}% (once)`));
        folder_id = suggest(vec, ex, strict);
      } catch (err) { console.error(err); }
      await sb.storage.from('vault').upload(`${base}.${ext}`, full, { contentType: files[i].type || 'image/jpeg' });
      await sb.storage.from('vault').upload(base + '_t.jpg', th, { contentType: 'image/jpeg' });
      await sb.from('images').insert({ id, folder_id, path: `${base}.${ext}`, thumb_path: base + '_t.jpg', name: files[i].name, embedding: vec });
    }
    setStatus('Done ✓'); e.target.value = ''; load();
  }

  async function autosort() {
    const ex = await known();
    const { data } = await sb.from('images').select('id,embedding').is('folder_id', null).limit(1000);
    let n = 0;
    for (const r of data || []) {
      const f = r.embedding && suggest(r.embedding, ex, strict);
      if (f) { await sb.from('images').update({ folder_id: f }).eq('id', r.id); n++; }
    }
    setStatus(`Sorted ${n} out of Inbox`); load();
  }
  const openFull = async i => { const { data } = await sb.storage.from('vault').createSignedUrl(i.path, 3600); setView(data?.signedUrl); };
  const opts = <>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</>;
  const title = tab === 'folders' ? 'FOLDERS' : tab === 'inbox' ? 'INBOX' : fid === 'all' ? 'LIBRARY' : folders.find(f => f.id === fid)?.name?.toUpperCase();

  return (
    <>
      <header>
        <div className="logo">LIKE BUTTER</div>
        <nav>
          {['library', 'folders', 'inbox'].map(t =>
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); if (t === 'library') setFid('all'); setPick(false); setSel(new Set()); }}>
              {t}{t === 'inbox' && ` (${images.filter(i => !i.folder_id).length})`}</button>)}
          <button className="alt" onClick={() => sb.auth.signOut()}>sign out</button>
        </nav>
      </header>
      <div className="marquee"><span>★ SAVE THE VIBE ★ KEEP IT FOREVER ★ SORT IT SMOOTH ★ SAVE THE VIBE ★ KEEP IT FOREVER ★ SORT IT SMOOTH</span></div>
      <main>
        <h1 className="mega">{title}</h1>

        {tab === 'folders' ? (<>
          <div className="box row">
            <input placeholder="new folder (e.g. Gojo, Cozy rooms, Sunsets)" value={name} onChange={e => setName(e.target.value)} />
            <button onClick={addFolder}>+ ADD</button>
          </div>
          <div className="folders">
            {folders.map((f, k) => (
              <div key={f.id} className={'fold c' + (k % 4)} onClick={() => { setFid(f.id); setTab('library'); }}>
                <b>{f.name}</b><span>{count(f.id)}</span>
                <i onClick={e => { e.stopPropagation(); delFolder(f.id); }}>✕</i>
              </div>))}
          </div>
        </>) : (<>
          <label className="drop">
            <b>+ DROP OR PICK IMAGES</b><span>{status || 'Auto-sorts using your folders as examples'}</span>
            <input type="file" accept="image/*" multiple onChange={upload} hidden />
          </label>
          <div className="box row">
            <label className="grow">AI strictness {strict}
              <input type="range" min="0.6" max="0.95" step="0.01" value={strict} onChange={e => setStrict(+e.target.value)} /></label>
            {tab === 'inbox' && <button onClick={autosort}>AUTO-SORT INBOX</button>}
            <button className={pick ? 'on' : 'alt'} onClick={() => { setPick(!pick); setSel(new Set()); }}>{pick ? 'CANCEL' : 'SELECT'}</button>
          </div>
          {tab === 'library' && <div className="chips">
            <button className={fid === 'all' ? 'on' : ''} onClick={() => setFid('all')}>All</button>
            {folders.map(f => <button key={f.id} className={fid === f.id ? 'on' : ''} onClick={() => setFid(f.id)}>{f.name}</button>)}
          </div>}
          {pick && sel.size > 0 && <div className="box row sticky">
            <b>{sel.size} selected</b>
            <select defaultValue="" onChange={e => e.target.value && move([...sel], e.target.value)}>
              <option value="">Move to…</option>{opts}</select>
            <button className="alt" onClick={() => move([...sel], null)}>TO INBOX</button>
            <button className="danger" onClick={() => del([...sel])}>DELETE</button>
          </div>}
          <div className="grid">
            {shown.map(i => (
              <div key={i.id} className={'tile' + (sel.has(i.id) ? ' on' : '')} onClick={() => pick ? toggle(i.id) : openFull(i)}>
                {urls[i.id] && <img src={urls[i.id]} loading="lazy" />}
              </div>))}
          </div>
          {!shown.length && <p className="empty">Nothing here yet.</p>}
          {shown.length >= limit && <button className="more" onClick={() => setLimit(limit + 200)}>LOAD MORE</button>}
        </>)}
      </main>
      {view && <div className="lightbox" onClick={() => setView(null)}><img src={view} /></div>}
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null), [ready, setReady] = useState(false);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setReady(true); });
    const { data: l } = sb.auth.onAuthStateChange((_, s) => setUser(s?.user ?? null));
    return () => l.subscription.unsubscribe();
  }, []);
  if (!ready) return null;
  return user ? <Vault user={user} /> : <Auth />;
}
