(() => {
  const boot = new URLSearchParams(location.hash.slice(1));
  const token = boot.get('admin') || '', csrf = boot.get('csrf') || '';
  history.replaceState(null, '', location.pathname);
  const q = s => document.querySelector(s);
  const headers = () => ({ 'x-pipiui-memory-admin': token, 'x-pipiui-memory-csrf': csrf, 'content-type': 'application/json' });
  const statuses = ['active', 'candidate', 'stale', 'superseded', 'rejected', 'deleted'];
  const actions = ['promote', 'reject', 'mark-stale', 'revalidate', 'edit', 'delete'];
  let selected = 'active', current = null;

  async function api(path, opts = {}) {
    const r = await fetch('/v1/memory-admin' + path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('Memory Center request failed');
    return r.json();
  }
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) node.append(child);
    return node;
  }

  function tabs() {
    const nav = q('#tabs');
    nav.replaceChildren(...statuses.map(s => {
      const button = el('button', { type: 'button', textContent: s });
      button.setAttribute('data-status', s);
      return button;
    }));
    nav.onclick = e => { const s = e.target.getAttribute?.('data-status'); if (s) { selected = s; load(); } };
  }

  // Claims are agent-derived text: build them as text nodes, never as markup.
  function row(record) {
    const button = el('button', { type: 'button', textContent: record.claim });
    button.prepend(el('b', { textContent: record.status }), ' ');
    button.setAttribute('data-id', record.id);
    return el('article', {}, [button, el('small', { textContent: `${record.kind} · ${record.scope.project}` })]);
  }

  async function load() {
    try {
      const p = new URLSearchParams({ status: selected, limit: '100' });
      for (const k of ['project', 'app', 'kind']) if (q('#' + k).value) p.set(k, q('#' + k).value);
      const d = await api('/records?' + p);
      const list = q('#records');
      list.replaceChildren(...(d.records.length ? d.records.map(row) : [el('p', { textContent: 'No records.' })]));
      list.onclick = e => { const hit = e.target.closest?.('[data-id]'); if (hit) detail(hit.getAttribute('data-id')); };
      q('#state').textContent = `${d.total} records`;
    } catch { q('#state').textContent = 'Memory Center offline or session expired.'; }
  }

  async function mutate(id, action) {
    let body = {};
    if (action === 'delete') { if (prompt('Type delete to confirm') !== 'delete') return; body = { confirm: 'delete' }; }
    if (action === 'edit') { const claim = prompt('New claim'); if (!claim) return; body = { claim }; }
    try {
      await api(`/records/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      await load();
      await detail(id);
    } catch { q('#state').textContent = `${action} failed.`; }
  }

  async function detail(id) {
    current = id;
    let d;
    try { d = await api('/records/' + encodeURIComponent(id)); } catch { q('#detail').textContent = 'Record unavailable.'; return; }
    if (current !== id) return;
    const bar = el('div', { className: 'actions' });
    // Each action is its own control; a text token inside <pre> is not clickable.
    for (const action of actions) {
      const button = el('button', { type: 'button', textContent: action });
      button.onclick = () => mutate(id, action);
      bar.append(button);
    }
    const node = q('#detail');
    node.replaceChildren(bar, el('code', { textContent: JSON.stringify(d, null, 2) }));
  }

  tabs();
  q('#refresh').onclick = load;
  load();
})();
