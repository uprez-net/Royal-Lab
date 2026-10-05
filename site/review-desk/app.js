// Builder Review Desk. A static page: it holds no credentials. A reviewer's
// personal link carries a presigned read URL for their invite file, which in
// turn holds presigned URLs for the shared task content and for the
// reviewer's own four answer files in private Vercel Blob.
// Reviewers are builders, not engineers: everything shown is translated into
// plain words, and technical detail stays in optional sections.
(() => {
  'use strict';

  // ---------- tiny DOM helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const kidsOf = (kids) => kids.flat(Infinity).filter((k) => k != null && k !== false && k !== '');
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kidsOf(kids)) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const fill = (node, ...kids) =>
    node.replaceChildren(
      ...kidsOf(kids).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))),
    );
  const now = () => new Date().toISOString();
  const fmtTime = (iso) => {
    try {
      return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const ls = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem(k));
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {}
    },
  };

  // ---------- plain-language translation ----------
  const FAMILY = {
    offers: 'Quotes and prices',
    analytics: 'Costs, cash and forecasts',
    compliance: 'Approvals and paperwork',
    insurance: 'Home warranty insurance',
    leads: 'New enquiries',
    projects: 'Running the job',
    safety: 'Staying safe and careful',
    tradies: 'Trades and bookings',
    finance: 'Payment claims',
    admin: 'Office access',
  };
  const famName = (f) => FAMILY[f] || f;
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const words = (s) =>
    String(s)
      .replace(/Cents$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_~]+/g, ' ')
      .trim()
      .toLowerCase();
  const money = (cents) =>
    '$' +
    (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const KIND_BY_EXT = { eml: 'email', csv: 'spreadsheet', json: 'system record', md: 'document' };
  const docKind = (name) => KIND_BY_EXT[name.split('.').pop()] || 'document';
  const docTitle = (name) =>
    cap(
      name
        .replace(/\.[a-z]+$/, '')
        .replace(/^doc\d+-/, '')
        .replace(/[-_]+/g, ' '),
    );
  function sourceName(pack, sourceId) {
    if (sourceId === 'policy') return 'the business rules';
    const doc = pack?.documents.find((d) => d.id === sourceId);
    return doc
      ? `the ${docTitle(doc.name).toLowerCase()} (${docKind(doc.name)})`
      : `the ${words(sourceId)}`;
  }
  function placeName(locator) {
    let m;
    if ((m = locator.match(/^(?:body:)?line:(\d+)$/))) return `line ${m[1]}`;
    if ((m = locator.match(/^row:(\d+)$/))) return `row ${m[1]}`;
    if ((m = locator.match(/^json:\/(\w+)\/(\d+)/)))
      return `${words(m[1]).replace(/s$/, '')} ${Number(m[2]) + 1}`;
    if (/^[A-Za-z]+$/.test(locator)) return `“${words(locator)}”`;
    return null;
  }
  const fromWhere = (pack, sourceId, locator) => {
    const place = placeName(locator);
    return cap(sourceName(pack, sourceId)) + (place ? `, ${place}` : '');
  };
  // Spreadsheet rows arrive as JSON arrays; show just the filled-in cells.
  const plainLine = (text) => {
    if (/^\[.*\]$/.test(text.trim()))
      try {
        return JSON.parse(text)
          .filter((c) => String(c).trim())
          .join('  ·  ');
      } catch {}
    return text;
  };
  function plainValue(c) {
    if (c.method !== 'deterministic' || !c.expected) return null;
    const field = c.expected.field || '';
    if (/caseId|seed/i.test(field)) return null;
    let v;
    try {
      v = JSON.parse(c.expected.value);
    } catch {
      return c.expected.value;
    }
    if (typeof v === 'number' && /cents$/i.test(field)) return money(v);
    if (typeof v === 'number' && /bp$|basisPoints/i.test(field))
      return (v / 100).toLocaleString('en-AU') + '%';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (Array.isArray(v))
      return v.length
        ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
        : 'None';
    if (v && typeof v === 'object')
      return Object.entries(v)
        .map(
          ([k, x]) =>
            `${cap(words(k))}: ${typeof x === 'boolean' ? (x ? 'yes' : 'no') : /cents$/i.test(k) && typeof x === 'number' ? money(x) : x}`,
        )
        .join('; ');
    if (typeof v === 'number') return v.toLocaleString('en-AU');
    return String(v);
  }
  // The assistant's brief mixes plain asks with file-format detail; lead with the plain part.
  function plainBrief(text) {
    const tech =
      /FILEREF|`|\[|locator|cents|field|pointer|schema|label|key figures|source-id|exactly as|integer/i;
    // File names such as review.md would otherwise split a sentence at the dot.
    const masked = text.replace(/\b[\w-]+\.(json|md|csv|eml|txt)\b/gi, 'FILEREF');
    const sentences = masked.match(/[^.!?]+[.!?]+(\s|$)/g) || [masked];
    const plain = sentences.map((s) => s.trim()).filter((s) => s && !tech.test(s));
    return plain.length ? plain.join(' ') : null;
  }
  const scenarioTime = (clock) => {
    try {
      return new Date(clock.instant).toLocaleString('en-AU', {
        timeZone: clock.timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return clock.instant;
    }
  };
  const importance = (c) =>
    !c.mandatory
      ? ['Nice to have', 'pill']
      : c.severity === 'critical'
        ? ['Must get right', 'pill fail']
        : ['Should get right', 'pill accent'];

  // ---------- documents, shown the way builders see them ----------
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') ((cell += '"'), i++);
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') (row.push(cell), (cell = ''));
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell || row.length) (row.push(cell), rows.push(row));
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function renderDocument(doc) {
    const kind = docKind(doc.name);
    if (kind === 'spreadsheet') {
      const [head, ...rows] = parseCsv(doc.text);
      return el(
        'div',
        { class: 'tablewrap sheet' },
        el(
          'table',
          {},
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { text: 'Row' }),
              (head || []).map((h) => el('th', { text: words(h) })),
            ),
          ),
          el(
            'tbody',
            {},
            rows.map((r, i) =>
              el(
                'tr',
                {},
                el('td', { class: 'rownum', text: String(i + 2) }),
                r.map((c) => el('td', { text: c })),
              ),
            ),
          ),
        ),
      );
    }
    if (kind === 'email') {
      const split = doc.text.search(/\r?\n\r?\n/);
      const headerText = split > 0 ? doc.text.slice(0, split) : '';
      const body = split > 0 ? doc.text.slice(split).trim() : doc.text;
      const headers = Object.fromEntries(
        headerText
          .split(/\r?\n/)
          .map((l) => l.match(/^([A-Za-z-]+):\s*(.*)$/))
          .filter(Boolean)
          .map((m) => [m[1].toLowerCase(), m[2]]),
      );
      return el(
        'div',
        { class: 'mail' },
        el(
          'dl',
          {},
          ['from', 'to', 'cc', 'date', 'subject']
            .filter((k) => headers[k])
            .map((k) => [el('dt', { text: cap(k) }), el('dd', { text: headers[k] })]),
        ),
        renderPaper(body),
      );
    }
    if (kind === 'system record') {
      let pretty = doc.text;
      try {
        pretty = JSON.stringify(JSON.parse(doc.text), null, 2);
      } catch {}
      return el('pre', { class: 'doc', text: pretty });
    }
    return renderPaper(doc.text);
  }
  // Markdown is shown formatted (sanitised); plain text is the fallback if the
  // libraries could not load.
  function renderPaper(text) {
    if (window.marked && window.DOMPurify) {
      const box = el('div', { class: 'paper md' });
      box.innerHTML = window.DOMPurify.sanitize(
        window.marked.parse(text, { gfm: true, breaks: true }),
      );
      for (const a of box.querySelectorAll('a'))
        (a.setAttribute('target', '_blank'), a.setAttribute('rel', 'noopener noreferrer'));
      return box;
    }
    const box = el('div', { class: 'paper' });
    for (const line of text.split('\n')) {
      const m = line.match(/^#{1,4}\s+(.*)$/);
      box.append(
        m
          ? el('span', { class: 'h', text: m[1] })
          : document.createTextNode(line.replace(/\*\*(.+?)\*\*/g, '$1') + '\n'),
      );
    }
    return box;
  }

  // ---------- state ----------
  const TYPES = ['profile', 'labels', 'reviews', 'proposals'];
  const S = {
    invite: null,
    content: null,
    docs: { profile: {}, labels: { items: {} }, reviews: { items: {} }, proposals: { items: {} } },
    curExample: null,
    curPack: null,
    curProposal: null,
  };
  const packByTask = (taskId) => S.content.packs.find((p) => p.taskId === taskId);

  function showBanner(msg, kind) {
    const b = $('#banner');
    b.textContent = msg;
    b.className = 'notice' + (kind ? ' ' + kind : '');
    b.hidden = false;
  }
  function setStatus(n, msg, err) {
    if (!n) return;
    n.textContent = msg;
    n.classList.toggle('err', !!err);
  }

  // ---------- saving: one upload at a time per file, coalesced ----------
  const localKey = (type) => `rd:${S.invite.builder}:${type}`;
  const queues = {};
  const statusEls = {};
  const lastStatus = {};
  // Renderers rebuild their status line; the latest save message follows it.
  function statusFor(type) {
    const st = el('p', { class: 'status', role: 'status' });
    statusEls[type] = st;
    if (lastStatus[type]) setStatus(st, ...lastStatus[type]);
    return st;
  }
  function typeStatus(type, msg, err) {
    lastStatus[type] = [msg, err];
    setStatus(statusEls[type], msg, err);
  }
  function save(type) {
    const doc = S.docs[type];
    doc.schemaVersion = 1;
    doc.builder = S.invite.builder;
    doc.updatedAt = now();
    ls.set(localKey(type), doc);
    const q = (queues[type] ||= { timer: null, running: false, dirty: false });
    q.dirty = true;
    clearTimeout(q.timer);
    return new Promise((resolve) => {
      q.timer = setTimeout(() => flush(type).then(resolve), 700);
    });
  }
  async function flush(type) {
    const q = queues[type];
    if (!q || q.running) return true;
    q.running = true;
    let ok = true;
    while (q.dirty) {
      q.dirty = false;
      typeStatus(type, 'Saving…');
      try {
        const res = await fetch(S.invite.files[type].put, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(S.docs[type]),
        });
        if (!res.ok) throw new Error(res.status === 403 ? 'expired' : 'failed');
        ok = true;
        typeStatus(type, 'Saved ' + fmtTime(now()));
      } catch (e) {
        ok = false;
        typeStatus(
          type,
          'Not saved yet. Your work is kept on this computer. Check your internet connection and try again, or download a backup from “Your details”.',
          true,
        );
        if (e.message === 'expired')
          showBanner(
            'Your link has expired, so your changes are only kept on this computer. Ask the person who invited you for a new link.',
            'bad',
          );
      }
    }
    q.running = false;
    return ok;
  }
  async function getJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
    return res.json();
  }

  // ---------- tabs ----------
  const TABS = ['you', 'label', 'review', 'propose'];
  function showTab(t) {
    if (!TABS.includes(t)) t = 'you';
    for (const x of TABS) {
      $('#panel-' + x).hidden = x !== t;
      $('#tab-' + x).setAttribute('aria-selected', String(x === t));
    }
    ls.set('rd:tab', t);
    window.scrollTo({ top: 0 });
  }
  document
    .querySelectorAll('nav.tabs button')
    .forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------- your details ----------
  const PF = { name: '#p-name', business: '#p-business', role: '#p-role', years: '#p-years' };
  const profile = () => S.docs.profile;
  const profileReady = () => {
    const p = profile();
    return !!(p.name && p.business && p.role && p.independent);
  };
  function renderProfile() {
    for (const [k, s] of Object.entries(PF)) $(s).value = profile()[k] ?? '';
    $('#p-independent').checked = !!profile().independent;
    statusEls.profile = $('#status-profile');
    renderWho();
  }
  function renderWho() {
    const p = profile();
    fill(
      $('#who'),
      p.name
        ? el('span', {}, 'Hello, ', el('strong', { text: p.name.split(' ')[0] }))
        : el('span', { text: 'Add your details to start' }),
    );
  }
  function onProfileInput() {
    const p = profile();
    for (const [k, s] of Object.entries(PF))
      p[k] = k === 'years' ? ($(s).value === '' ? null : Number($(s).value)) : $(s).value.trim();
    p.independent = $('#p-independent').checked;
    renderWho();
    renderLabelMain();
    renderReviewMain();
    renderProposalMain();
    save('profile');
  }
  Object.values(PF).forEach((s) => $(s).addEventListener('input', onProfileInput));
  $('#p-independent').addEventListener('change', onProfileInput);
  const needProfile = () =>
    el(
      'div',
      { class: 'notice' },
      'Before you start, please fill in ',
      el(
        'button',
        { class: 'btn ghost', type: 'button', onclick: () => showTab('you') },
        'your details',
      ),
      ' (your name, business, role, and tick the box).',
    );
  function confirmButton(label, confirmLabel, confirmText, disabled, action) {
    const st = el('p', { class: 'status' });
    let armed = false;
    const b = el(
      'button',
      {
        class: 'btn primary big',
        type: 'button',
        disabled,
        onclick: async () => {
          if (!armed) {
            armed = true;
            b.textContent = confirmLabel;
            st.textContent = confirmText;
            return;
          }
          b.disabled = true;
          await action();
        },
      },
      label,
    );
    return el('div', { class: 'row' }, b, st);
  }

  // ---------- check the answers ----------
  const labels = () => S.docs.labels;
  const labelsLocked = () => !!labels().submittedAt;
  function renderLabelIndex() {
    const ex = S.content.examples;
    const box = $('#label-index');
    fill(
      box,
      ex.map((e) => {
        const l = labels().items[e.id]?.label;
        return el(
          'button',
          {
            type: 'button',
            'aria-current': String(S.curExample === e.id),
            onclick: () => {
              S.curExample = e.id;
              renderLabelIndex();
              renderLabelMain();
              window.scrollTo({ top: 0 });
            },
          },
          el('span', { text: 'Answer ' + e.order }),
          l
            ? el('span', {
                class: 'pill ' + (l === 'pass' ? 'pass' : 'fail'),
                text: l === 'pass' ? 'good' : 'not good',
              })
            : el('span', { class: 'pill', text: 'to do' }),
        );
      }),
    );
    const done = ex.filter((e) => labels().items[e.id]?.label).length;
    $('#label-progress').style.width = (100 * done) / ex.length + '%';
    $('#label-progress-text').textContent = labelsLocked()
      ? 'All ' + ex.length + ' sent'
      : done + ' of ' + ex.length + ' done';
    $('#count-label').textContent = done + '/' + ex.length;
  }
  function renderLabelMain() {
    const main = $('#label-main');
    if (!profileReady()) return fill(main, needProfile());
    const list = S.content.examples;
    const ex = list.find((e) => e.id === S.curExample) || list[0];
    S.curExample = ex.id;
    const pack = packByTask(ex.taskId);
    const cur = labels().items[ex.id] || {};
    const locked = labelsLocked();
    const st = statusFor('labels');
    const note = el('textarea', {
      id: 'note-' + ex.id,
      placeholder: 'Optional: why did you decide this?',
      disabled: locked,
    });
    note.value = cur.note || '';
    const record = (patch) => {
      labels().pack = S.content.calibrationPack;
      labels().items[ex.id] = {
        ...(labels().items[ex.id] || {}),
        ...patch,
        evidenceHash: ex.evidenceHash,
        taskId: ex.taskId,
        criterionId: ex.criterion.id,
        updatedAt: now(),
      };
      renderLabelIndex();
      save('labels');
    };
    note.addEventListener('input', () => record({ note: note.value.trim() }));
    const choice = (v, text) =>
      el(
        'button',
        {
          type: 'button',
          class: v,
          'aria-pressed': String(cur.label === v),
          disabled: locked,
          onclick: () => {
            record({ label: v, note: note.value.trim() });
            renderLabelMain();
          },
        },
        text,
      );
    const idx = list.indexOf(ex);
    const go = (d) => {
      const n = list[idx + d];
      if (!n) return;
      S.curExample = n.id;
      renderLabelIndex();
      renderLabelMain();
      window.scrollTo({ top: 0 });
    };
    const allDone = list.every((e) => labels().items[e.id]?.label);
    fill(
      main,
      el(
        'div',
        { class: 'stack' },
        el('span', {
          class: 'eyebrow',
          text:
            'Answer ' +
            ex.order +
            ' of ' +
            list.length +
            (pack ? ' · ' + famName(pack.family) : ''),
        }),
        el('h2', { text: ex.criterion.title }),
      ),
      el(
        'div',
        { class: 'std' },
        el('div', { class: 'p' }, el('b', { text: 'Good if it…' }), ex.criterion.passIf),
        el('div', { class: 'f' }, el('b', { text: 'Not good if it…' }), ex.criterion.failIf),
      ),
      el(
        'div',
        { class: 'stack' },
        el('h3', { text: 'What the paperwork says' }),
        el(
          'ul',
          { class: 'src' },
          ex.sources.map((s) =>
            el(
              'li',
              {},
              el('span', { class: 'where', text: fromWhere(pack, s.sourceId, s.locator) }),
              el('span', { text: plainLine(s.text) }),
            ),
          ),
        ),
      ),
      el(
        'div',
        { class: 'stack' },
        el('h3', { text: "The assistant's answer" }),
        ex.deliverables.map((d) => renderPaper(d.text)),
      ),
      el(
        'div',
        { class: 'panel stack' },
        el('h3', { text: 'Is this a good answer?' }),
        el(
          'div',
          { class: 'verdict' },
          choice('pass', 'Yes, good'),
          choice('fail', 'No, not good'),
        ),
        el('label', { class: 'field', for: 'note-' + ex.id }, 'Your reason', note),
        st,
        el(
          'div',
          { class: 'row between' },
          el(
            'button',
            { class: 'btn', type: 'button', disabled: idx === 0, onclick: () => go(-1) },
            '← Back',
          ),
          idx < list.length - 1
            ? el(
                'button',
                { class: 'btn primary', type: 'button', onclick: () => go(1) },
                'Next answer →',
              )
            : null,
        ),
      ),
      locked
        ? el(
            'div',
            { class: 'notice good' },
            'Thank you. You sent your answers on ' +
              fmtTime(labels().submittedAt) +
              '. If you need to change one, contact the person who invited you.',
          )
        : el(
            'div',
            { class: 'panel stack' },
            el('h3', { text: 'Finished?' }),
            el('p', {
              class: 'muted',
              text: allDone
                ? 'You have checked all ' + list.length + ' answers. Send them when you are happy.'
                : 'Check all ' +
                  list.length +
                  ' answers, then send them here. Everything saves as you go, so you can stop and come back any time.',
            }),
            confirmButton(
              'Send my answers',
              'Yes, send them',
              "Press again to send. You won't be able to change them after this.",
              !allDone,
              async () => {
                labels().submittedAt = now();
                const ok = await save('labels');
                if (!ok) delete labels().submittedAt;
                renderLabelIndex();
                renderLabelMain();
              },
            ),
          ),
    );
  }

  // ---------- review a job ----------
  const reviews = () => S.docs.reviews.items;
  const reviewStatus = (k) =>
    reviews()[k]?.submittedAt ? 'sent' : reviews()[k] ? 'started' : null;
  function renderReviewIndex() {
    const box = $('#review-index');
    const f = $('#r-filter').value;
    const q = $('#r-search').value.trim().toLowerCase();
    const list = S.content.packs.filter(
      (p) =>
        (!f || p.family === f) &&
        (!q || (p.title + ' ' + famName(p.family)).toLowerCase().includes(q)),
    );
    let grp = null;
    const items = [];
    for (const p of list) {
      if (p.family !== grp) {
        grp = p.family;
        items.push(el('div', { class: 'grp', text: famName(grp) }));
      }
      const s = reviewStatus(p.key);
      items.push(
        el(
          'button',
          {
            type: 'button',
            'aria-current': String(S.curPack === p.key),
            onclick: () => openPack(p.key),
          },
          el('span', { text: p.title }),
          s ? el('span', { class: 'pill ' + (s === 'sent' ? 'pass' : 'warn'), text: s }) : null,
        ),
      );
    }
    if (!list.length)
      items.push(el('p', { class: 'muted small', text: 'Nothing matches that search.' }));
    fill(box, items);
    const n = Object.values(reviews()).filter((r) => r.submittedAt).length;
    $('#count-review').textContent = n ? String(n) : '';
  }
  $('#r-filter').addEventListener('change', renderReviewIndex);
  $('#r-search').addEventListener('input', renderReviewIndex);
  function openPack(key) {
    S.curPack = key;
    ls.set('rd:pack', key);
    renderReviewIndex();
    renderReviewMain();
    window.scrollTo({ top: 0 });
  }
  const CHECKS = [
    ['sources', 'Does the paperwork look like the real thing a builder would get?'],
    ['policy', 'Are the business rules how a builder should run this?'],
    ['expected', 'Are the right answers actually right?'],
    ['wrong', 'Are the wrong answers mistakes people really make?'],
  ];
  const DECISIONS = [
    ['approve', 'Looks right'],
    ['amend', 'Right, with small fixes'],
    ['changes', 'Needs fixing'],
    ['skip', 'Not my area'],
  ];
  function renderReviewMain() {
    const main = $('#review-main');
    if (!S.curPack) return;
    if (!profileReady()) return fill(main, needProfile());
    const pack = S.content.packs.find((p) => p.key === S.curPack);
    if (!pack)
      return fill(main, el('div', { class: 'empty', text: 'This job is no longer on the list.' }));
    const r = reviews()[pack.key] ? clone(reviews()[pack.key]) : {};
    r.checks ||= {};
    r.criteriaIssues ||= {};
    const locked = !!r.submittedAt;
    const changed = r.contentHash && r.contentHash !== pack.contentHash;
    const st = statusFor('reviews');
    const persist = () => {
      Object.assign(r, {
        taskId: pack.taskId,
        packVersion: pack.version,
        contentHash: pack.contentHash,
        updatedAt: now(),
      });
      reviews()[pack.key] = clone(r);
      renderReviewIndex();
      return save('reviews');
    };
    const policy = S.content.policies[pack.policyKey];
    const seg = (name, opts, value, onpick) =>
      el(
        'div',
        { class: 'seg', role: 'group', 'aria-label': name },
        opts.map(([v, t]) =>
          el(
            'button',
            {
              type: 'button',
              'aria-pressed': String(value === v),
              disabled: locked,
              onclick: () => onpick(v),
            },
            t,
          ),
        ),
      );
    const amend = el('textarea', {
      id: 'amend-' + pack.key,
      disabled: locked,
      placeholder:
        'For example: “The insurance limit should be $20,000, not $15,000” or “Nobody sends this by text message”.',
    });
    amend.value = r.amendments || '';
    amend.addEventListener('input', () => {
      r.amendments = amend.value;
      persist();
    });
    const brief = plainBrief(pack.instruction);
    const titles = Object.fromEntries(pack.criteria.map((c) => [c.id, c.title]));
    const expectations = pack.criteria.map((c) => {
      const id = 'ci-' + pack.key + '-' + c.id;
      const ta = el('textarea', { id, disabled: locked, placeholder: 'What is wrong with this?' });
      ta.value = r.criteriaIssues[c.id] || '';
      ta.hidden = !(c.id in r.criteriaIssues);
      ta.addEventListener('input', () => {
        r.criteriaIssues[c.id] = ta.value;
        persist();
      });
      const cb = el('input', { type: 'checkbox', id: 'cb-' + id, disabled: locked });
      cb.checked = !ta.hidden;
      cb.addEventListener('change', () => {
        ta.hidden = !cb.checked;
        if (cb.checked) r.criteriaIssues[c.id] = ta.value;
        else delete r.criteriaIssues[c.id];
        persist();
      });
      const value = plainValue(c);
      const [imp, impClass] = importance(c);
      return el(
        'li',
        { class: 'expect' },
        el(
          'div',
          { class: 'row between' },
          el('b', { text: c.title }),
          el('span', { class: impClass, text: imp }),
        ),
        value != null
          ? el('div', { class: 'value' }, 'Correct answer: ', el('strong', { text: value }))
          : null,
        c.passIf
          ? el('div', { class: 'small' }, el('b', { text: 'Good if it… ' }), c.passIf)
          : null,
        c.failIf
          ? el('div', { class: 'small' }, el('b', { text: 'Not good if it… ' }), c.failIf)
          : null,
        c.evidence.length
          ? el(
              'ul',
              { class: 'facts' },
              c.evidence.map((e) =>
                el(
                  'li',
                  {},
                  el('span', {
                    class: 'where',
                    text: fromWhere(pack, e.sourceId, e.locator) + ': ',
                  }),
                  e.fact,
                ),
              ),
            )
          : null,
        el(
          'label',
          { class: 'check small', for: 'cb-' + id },
          cb,
          el('span', { text: "I don't agree with this" }),
        ),
        el('div', { class: 'crit-issue' }, ta),
      );
    });
    const canSend =
      r.decision &&
      CHECKS.every(([k]) => r.checks[k]) &&
      (r.decision === 'approve' || r.decision === 'skip' || (r.amendments || '').trim());
    fill(
      main,
      el(
        'div',
        { class: 'stack' },
        el('span', { class: 'eyebrow', text: famName(pack.family) }),
        el('h2', { text: pack.title }),
        el('p', {
          class: 'muted',
          text:
            'Set on ' +
            scenarioTime(pack.clock) +
            ' (Sydney time). All people and businesses are made up.',
        }),
      ),
      changed
        ? el(
            'div',
            { class: 'notice' },
            'We have updated this job since you last looked. Please read it again before you send.',
          )
        : null,
      el(
        'section',
        { class: 'step' },
        el('h3', {}, el('span', { class: 'num', text: '1' }), 'The job'),
        el('p', { class: 'lead', text: brief || pack.title }),
        pack.allowedOutcomes?.length
          ? el(
              'p',
              { class: 'muted small' },
              'A good result: ' +
                pack.allowedOutcomes.map((o) => o.description).join(', or ') +
                '.',
            )
          : null,
        el(
          'details',
          { class: 'quiet' },
          el('summary', {
            text: 'Exact wording given to the assistant (technical, you can skip this)',
          }),
          el('div', { class: 'body' }, el('p', { class: 'small', text: pack.instruction })),
        ),
      ),
      el(
        'section',
        { class: 'step' },
        el('h3', {}, el('span', { class: 'num', text: '2' }), 'The paperwork'),
        el('p', { class: 'muted small', text: 'Open each one to read it.' }),
        pack.documents.map((d) =>
          el(
            'details',
            {},
            el(
              'summary',
              {},
              docTitle(d.name),
              ' ',
              el('span', { class: 'pill', text: docKind(d.name) }),
            ),
            el('div', { class: 'body' }, renderDocument(d)),
          ),
        ),
        policy
          ? el(
              'details',
              {},
              el('summary', {}, 'Business rules ', el('span', { class: 'pill', text: 'rules' })),
              el('div', { class: 'body' }, renderPaper(policy.text)),
            )
          : null,
      ),
      el(
        'section',
        { class: 'step' },
        el(
          'h3',
          {},
          el('span', { class: 'num', text: '3' }),
          'What a correct answer must get right',
        ),
        el('p', {
          class: 'muted small',
          text: 'Tick “I don’t agree with this” on anything that is wrong or unrealistic, and say why.',
        }),
        el('ul', { class: 'expects' }, expectations),
      ),
      pack.controls.some((c) => c.kind !== 'reference')
        ? el(
            'section',
            { class: 'step' },
            el('h3', {}, el('span', { class: 'num', text: '4' }), 'Wrong answers it should catch'),
            el('p', {
              class: 'muted small',
              text: 'Made-up wrong answers we test with. Each one should be marked wrong on the points listed.',
            }),
            el(
              'ul',
              { class: 'expects' },
              pack.controls
                .filter((c) => c.kind !== 'reference')
                .map((c) =>
                  el(
                    'li',
                    { class: 'expect' },
                    el('b', { text: cap(words(c.id)) }),
                    el('div', { text: c.description }),
                    el(
                      'div',
                      { class: 'small muted' },
                      c.fails.length
                        ? 'Should be marked wrong on: ' +
                            c.fails.map((id) => titles[id] || id).join('; ')
                        : 'Should be marked wrong overall.',
                    ),
                  ),
                ),
            ),
          )
        : null,
      el(
        'section',
        { class: 'step panel' },
        el(
          'h3',
          {},
          el('span', {
            class: 'num',
            text: pack.controls.some((c) => c.kind !== 'reference') ? '5' : '4',
          }),
          'Your verdict',
        ),
        CHECKS.map(([k, t]) =>
          el(
            'div',
            { class: 'question' },
            el('span', { text: t }),
            seg(
              t,
              [
                ['yes', 'Yes'],
                ['no', 'No'],
                ['unsure', 'Not sure'],
              ],
              r.checks[k],
              (v) => {
                r.checks[k] = v;
                persist();
                renderReviewMain();
              },
            ),
          ),
        ),
        el(
          'div',
          { class: 'question' },
          el('b', { text: 'Overall' }),
          seg('Overall', DECISIONS, r.decision, (v) => {
            r.decision = v;
            persist();
            renderReviewMain();
          }),
        ),
        el(
          'label',
          { class: 'field', for: 'amend-' + pack.key },
          'What would you change?',
          el('span', {
            class: 'hint',
            text: 'Needed unless you chose “Looks right” or “Not my area”.',
          }),
          amend,
        ),
        st,
        locked
          ? el('div', {
              class: 'notice good',
              text: 'Thank you. You sent this review on ' + fmtTime(r.submittedAt) + '.',
            })
          : confirmButton(
              'Send this review',
              'Yes, send it',
              "Press again to send. You won't be able to change it after this.",
              !canSend,
              async () => {
                r.submittedAt = now();
                await persist();
                renderReviewMain();
              },
            ),
      ),
      pack.environment
        ? el(
            'details',
            { class: 'quiet' },
            el('summary', { text: 'Technical setup (for the tech team, you can skip this)' }),
            el('div', { class: 'body' }, el('pre', { class: 'doc', text: pack.environment })),
          )
        : null,
    );
  }

  // ---------- suggest a job ----------
  const proposals = () => S.docs.proposals.items;
  const DOC_KINDS = [
    'Email',
    'Quote or estimate',
    'Spreadsheet',
    'Invoice or claim',
    'Contract',
    'Certificate',
    'Site note',
    'Text message',
    'Other',
  ];
  const blankProposal = () => ({
    id: 'p' + Date.now().toString(36),
    title: '',
    family: '',
    setting: '',
    instruction: '',
    documents: [{ name: '', kind: 'Email', content: '' }],
    rules: '',
    mustDo: [{ statement: '', check: '' }],
    figures: [{ label: '', value: '' }],
    traps: [{ mistake: '', consequence: '' }],
    mustNot: '',
    approvals: '',
    difficulty: 'medium',
    notes: '',
    synthetic: false,
    createdAt: now(),
  });
  function renderProposalIndex() {
    const list = Object.values(proposals()).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || ''),
    );
    fill(
      $('#proposal-index'),
      list.map((p) =>
        el(
          'button',
          {
            type: 'button',
            'aria-current': String(S.curProposal === p.id),
            onclick: () => {
              S.curProposal = p.id;
              renderProposalIndex();
              renderProposalMain();
            },
          },
          el('span', { text: p.title || 'Untitled idea' }),
          el('span', {
            class: 'pill ' + (p.submittedAt ? 'pass' : 'warn'),
            text: p.submittedAt ? 'sent' : 'draft',
          }),
        ),
      ),
      list.length ? null : el('p', { class: 'muted small', text: 'No ideas yet.' }),
    );
    const n = list.filter((p) => p.submittedAt).length;
    $('#count-propose').textContent = n ? String(n) : '';
  }
  $('#new-proposal').addEventListener('click', () => {
    if (!profileReady()) return showTab('you');
    const p = blankProposal();
    proposals()[p.id] = p;
    S.curProposal = p.id;
    renderProposalIndex();
    renderProposalMain();
  });
  function renderProposalMain() {
    const main = $('#proposal-main');
    if (!S.curProposal) return;
    if (!profileReady()) return fill(main, needProfile());
    const p = proposals()[S.curProposal];
    if (!p) return;
    const locked = !!p.submittedAt;
    const st = statusFor('proposals');
    const persist = () => {
      p.updatedAt = now();
      renderProposalIndex();
      return save('proposals');
    };
    const field = (key, label, hint, kind = 'input') => {
      const id = 'pp-' + p.id + '-' + key;
      const inp =
        kind === 'textarea'
          ? el('textarea', { id, disabled: locked })
          : el('input', { type: 'text', id, disabled: locked });
      inp.value = p[key] || '';
      inp.addEventListener('input', () => {
        p[key] = inp.value;
        persist();
      });
      return el(
        'label',
        { class: 'field', for: id },
        label,
        hint ? el('span', { class: 'hint', text: hint }) : null,
        inp,
      );
    };
    const select = (key, label, opts) => {
      const id = 'pp-' + p.id + '-' + key;
      const s = el(
        'select',
        { id, disabled: locked },
        opts.map(([v, t]) => el('option', { value: v, text: t })),
      );
      s.value = p[key] || '';
      s.addEventListener('change', () => {
        p[key] = s.value;
        persist();
      });
      return el('label', { class: 'field', for: id }, label, s);
    };
    const repeat = (key, fields, addLabel, blank) =>
      el(
        'div',
        { class: 'repeat' },
        p[key].map((row, i) =>
          el(
            'div',
            { class: 'item' },
            fields.map(([fk, flabel, fkind, opts]) => {
              const id = 'pp-' + p.id + '-' + key + i + fk;
              const inp =
                fkind === 'select'
                  ? el(
                      'select',
                      { id, disabled: locked },
                      opts.map((o) => el('option', { value: o, text: o })),
                    )
                  : fkind === 'textarea'
                    ? el('textarea', {
                        id,
                        class: fk === 'content' ? 'tall' : null,
                        disabled: locked,
                      })
                    : el('input', { type: 'text', id, disabled: locked });
              inp.value = row[fk] || '';
              inp.addEventListener(fkind === 'select' ? 'change' : 'input', () => {
                row[fk] = inp.value;
                persist();
              });
              return el('label', { class: 'field', for: id }, flabel, inp);
            }),
            !locked && p[key].length > 1
              ? el(
                  'div',
                  {},
                  el(
                    'button',
                    {
                      class: 'btn ghost',
                      type: 'button',
                      onclick: () => {
                        p[key].splice(i, 1);
                        persist();
                        renderProposalMain();
                      },
                    },
                    'Remove',
                  ),
                )
              : null,
          ),
        ),
        locked
          ? null
          : el(
              'div',
              {},
              el(
                'button',
                {
                  class: 'btn',
                  type: 'button',
                  onclick: () => {
                    p[key].push(blank());
                    persist();
                    renderProposalMain();
                  },
                },
                addLabel,
              ),
            ),
      );
    const syn = el('input', { type: 'checkbox', id: 'pp-' + p.id + '-syn', disabled: locked });
    syn.checked = !!p.synthetic;
    syn.addEventListener('change', () => {
      p.synthetic = syn.checked;
      persist();
      renderProposalMain();
    });
    const ready =
      p.synthetic &&
      p.title.trim() &&
      p.instruction.trim() &&
      p.documents.some((d) => d.content.trim()) &&
      p.mustDo.some((m) => m.statement.trim()) &&
      p.traps.some((t) => t.mistake.trim());
    fill(
      main,
      el(
        'div',
        { class: 'stack' },
        el('span', {
          class: 'eyebrow',
          text: locked ? 'Sent ' + fmtTime(p.submittedAt) : 'Saves as you type',
        }),
        el('h2', { text: p.title || 'Your idea for a test job' }),
      ),
      el(
        'div',
        { class: 'notice' },
        "Please make everything up: names, addresses, licence numbers and amounts. Don't copy in real emails, quotes or contracts.",
      ),
      el(
        'section',
        { class: 'step panel' },
        el('h3', {}, el('span', { class: 'num', text: '1' }), 'The job'),
        field(
          'title',
          'Give it a short name',
          'For example: “Check a progress claim before it goes to the owner”',
        ),
        el(
          'div',
          { class: 'grid2' },
          select('family', 'What kind of work is it?', [
            ['', 'Choose…'],
            ...Object.entries(FAMILY),
          ]),
          select('difficulty', 'How easy is it to get wrong?', [
            ['easy', 'Easy to get right'],
            ['medium', 'A few traps'],
            ['hard', 'Even experienced staff slip up'],
          ]),
        ),
        field(
          'setting',
          "What's going on?",
          'The job, the people involved and what has happened so far. A few sentences is plenty.',
          'textarea',
        ),
        field(
          'instruction',
          'What would you ask the assistant to do?',
          'Say it the way you would say it to a new person in the office.',
          'textarea',
        ),
      ),
      el(
        'section',
        { class: 'step panel' },
        el('h3', {}, el('span', { class: 'num', text: '2' }), 'The paperwork it would use'),
        el('p', {
          class: 'muted small',
          text: 'Type a made-up version of each email, quote, spreadsheet or note. Include the mistakes you want it to notice.',
        }),
        repeat(
          'documents',
          [
            ['name', 'What is it?', 'input'],
            ['kind', 'Type', 'select', DOC_KINDS],
            ['content', 'What it says', 'textarea'],
          ],
          '+ Add another piece of paperwork',
          () => ({ name: '', kind: 'Email', content: '' }),
        ),
        field(
          'rules',
          'Any business rules that apply?',
          'For example: markups, who has to approve what, what must never go out without you seeing it.',
          'textarea',
        ),
      ),
      el(
        'section',
        { class: 'step panel' },
        el('h3', {}, el('span', { class: 'num', text: '3' }), 'What a good answer does'),
        repeat(
          'mustDo',
          [
            ['statement', 'It must…', 'input'],
            ['check', 'How would you know it did?', 'input'],
          ],
          '+ Add another',
          () => ({ statement: '', check: '' }),
        ),
        el('p', {
          class: 'muted small',
          text: 'Any exact numbers or dates it should come up with:',
        }),
        repeat(
          'figures',
          [
            ['label', 'What', 'input'],
            ['value', 'Correct amount or date', 'input'],
          ],
          '+ Add another',
          () => ({ label: '', value: '' }),
        ),
        field(
          'mustNot',
          'What must it never do?',
          'For example: send it to the client, change the price, guess a certificate number.',
          'textarea',
        ),
        field('approvals', 'When should it stop and check with you first?', null, 'textarea'),
      ),
      el(
        'section',
        { class: 'step panel' },
        el('h3', {}, el('span', { class: 'num', text: '4' }), 'Mistakes it should avoid'),
        el('p', {
          class: 'muted small',
          text: 'The easy mistakes: the ones a tired estimator or an over-confident assistant would make.',
        }),
        repeat(
          'traps',
          [
            ['mistake', 'The mistake', 'input'],
            ['consequence', 'What it would cost you', 'input'],
          ],
          '+ Add another mistake',
          () => ({ mistake: '', consequence: '' }),
        ),
      ),
      el(
        'section',
        { class: 'step panel' },
        field('notes', 'Anything else?', null, 'textarea'),
        el(
          'label',
          { class: 'check', for: 'pp-' + p.id + '-syn' },
          syn,
          el('span', {
            text: 'Everything above is made up. Nothing has been copied from real clients, suppliers or documents.',
          }),
        ),
        st,
        locked
          ? el('div', {
              class: 'notice good',
              text: 'Thank you. We will turn this into a test job and ask you to check it.',
            })
          : el(
              'div',
              { class: 'stack' },
              confirmButton(
                'Send my idea',
                'Yes, send it',
                "Press again to send. You won't be able to change it after this.",
                !ready,
                async () => {
                  p.submittedAt = now();
                  await persist();
                  renderProposalIndex();
                  renderProposalMain();
                },
              ),
              ready
                ? null
                : el('span', {
                    class: 'small muted',
                    text: 'To send, fill in: a name, what you would ask, at least one piece of paperwork, one thing a good answer does, one mistake, and tick the box.',
                  }),
            ),
      ),
    );
  }

  // ---------- backup ----------
  $('#dl-btn').addEventListener('click', () => {
    const data = JSON.stringify(
      { exportedAt: now(), builder: S.invite.builder, ...clone(S.docs) },
      null,
      2,
    );
    const name = 'my-review-answers-' + now().slice(0, 10) + '.json';
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setStatus($('#status-dl'), 'Downloaded ' + name);
  });
  $('#forget-btn').addEventListener('click', () => {
    const b = $('#forget-btn');
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.textContent = 'Yes, sign out on this computer';
      setStatus(
        $('#status-dl'),
        'Your saved answers are kept safe. You will need your link to come back.',
      );
      return;
    }
    for (const t of TYPES) ls.del(localKey(t));
    ls.del('rd:invite');
    location.replace(location.pathname);
  });

  // ---------- start ----------
  async function boot() {
    const m = location.hash.match(/(?:^#|&)invite=([^&]+)/);
    if (m) {
      ls.set('rd:invite', decodeURIComponent(m[1]));
      history.replaceState(null, '', location.pathname + location.search);
    }
    const inviteUrl = ls.get('rd:invite');
    if (!inviteUrl) {
      $('#who').textContent = '';
      $('#gate').hidden = false;
      return;
    }
    try {
      S.invite = await getJson(inviteUrl);
      if (!S.invite) throw Object.assign(new Error('missing'), { status: 404 });
      if (Date.parse(S.invite.validUntil) < Date.now())
        throw Object.assign(new Error('expired'), { status: 403 });
      const [content, ...docs] = await Promise.all([
        getJson(S.invite.content),
        ...TYPES.map((t) => getJson(S.invite.files[t].get).catch(() => null)),
      ]);
      if (!content) throw new Error('not ready');
      S.content = content;
      TYPES.forEach((t, i) => {
        const remote = docs[i];
        const local = ls.get(localKey(t));
        const pick = !remote
          ? local
          : !local
            ? remote
            : (local.updatedAt || '') > (remote.updatedAt || '')
              ? local
              : remote;
        if (pick) S.docs[t] = pick;
        if (t !== 'profile') S.docs[t].items ||= {};
        if (pick && pick === local && local !== remote) save(t);
      });
    } catch (e) {
      $('#who').textContent = '';
      $('#gate').hidden = false;
      showBanner(
        e.status === 403 || e.message === 'expired'
          ? 'This link has expired. Please ask the person who invited you for a new one.'
          : e.status === 404
            ? "This link doesn't work. Check you copied all of it, or ask for a new one."
            : "We couldn't open your desk. Check your internet connection and reload the page.",
        'bad',
      );
      return;
    }
    if (!profile().name && S.invite.name) profile().name = S.invite.name;
    if (!profile().business && S.invite.business) profile().business = S.invite.business;
    $('#app').hidden = false;
    if (Date.parse(S.invite.validUntil) - Date.now() < 3 * 24 * 3600 * 1000)
      showBanner(
        'Your link stops working on ' +
          fmtTime(S.invite.validUntil) +
          '. Ask for a new one if you need more time.',
      );
    for (const f of [...new Set(S.content.packs.map((p) => p.family))].sort((a, b) =>
      famName(a).localeCompare(famName(b)),
    ))
      $('#r-filter').append(el('option', { value: f, text: famName(f) }));
    renderProfile();
    renderLabelIndex();
    renderLabelMain();
    renderReviewIndex();
    const lastPack = ls.get('rd:pack');
    if (lastPack && S.content.packs.some((p) => p.key === lastPack)) openPack(lastPack);
    S.curProposal = Object.keys(proposals())[0] || null;
    renderProposalIndex();
    renderProposalMain();
    showTab(ls.get('rd:tab') || 'you');
  }
  boot();
})();
