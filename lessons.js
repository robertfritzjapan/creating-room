/* ============================================================
   Creating Room — 21 Lessons（期 → 回 → 本文）
   index.html の後に読み込む。S / supa / $ / esc / toast などは index.html のものを使う。
   ============================================================ */

const L = {
  cohorts: [],        // 全期（cohorts_select は全員に開いている）
  myCM: [],           // 自分の cohort_members
  editorRooms: [],    // 自分が editor 以上の部屋 id
  cohort: null,       // 表示中の期
  lessons: [],        // 表示中の期の回
  reads: {},          // lesson_id -> true
  pins: {},           // 'lesson:'+id / 'comment:'+id -> true
  postDraft: null,    // 入稿画面の状態
  queueCount: 0,
};

const LESSONS_SLUG = 'lessons21';
const isLessonsRoom = room => !!room && (room.slug === LESSONS_SLUG || room.kind === 'lessons');
const cohortRoom = c => S.rooms.find(r => r.id === c.room_id);
const myCMFor = cohortId => L.myCM.find(m => m.cohort_id === cohortId);
const isPaidFor = cohortId => !!myCMFor(cohortId)?.paid_at;
const canEditCohort = c => !!c && canEdit(c.room_id);
const fmtDateJ = iso => iso ? new Date(iso).toLocaleDateString('ja-JP', { timeZone:'Asia/Tokyo', year:'numeric', month:'long', day:'numeric' }) : '';
const fmtWhen = iso => {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const same = d.toLocaleDateString('ja-JP', JST) === now.toLocaleDateString('ja-JP', JST);
  return (same ? '今日 ' : fmtDay(iso) + ' ') + fmtTime(iso);
};
const nl2br = t => esc(t || '').replace(/\n/g, '<br>');
const errBox = e => `<div class="empty">読み込みに失敗しました<br><span style="font-size:11px;color:#999">${esc(e?.code || '')} ${esc(e?.message || '')}</span></div>`;

/* ---------- 起動時に呼ぶ（index.html の start() から） ---------- */
async function lessonsBootstrap(){
  const [c, m] = await Promise.all([
    supa.from('cohorts').select('*').order('sort_order').order('starts_on', { ascending:false }),
    supa.from('cohort_members').select('*').eq('user_id', S.user.id),
  ]);
  L.cohorts = c.data || [];
  L.myCM = m.data || [];
  L.editorRooms = S.memberships.filter(x => ['admin','editor'].includes(x.role)).map(x => x.room_id);
  L.postDraft = null;
  if (editorOfLessons()) refreshQueueCount();
}
const editorOfLessons = () => S.rooms.some(r => isLessonsRoom(r) && canEdit(r.id));
const editorCohorts = () => L.cohorts.filter(c => canEditCohort(c));

async function refreshQueueCount(){
  const q = await fetchQueue();
  L.queueCount = q.length;
  refreshQueueBadge();
  return L.queueCount;
}

/* ---------- ホームの2行目（index.html の openHome から） ----------
   入っている場所を見て、今日動いているものが1つあればそれ。なければ直近の予定。どちらもなければ ''。 */
async function lessonsHomeStatus(){
  if (editorOfLessons()) {
    const n = await refreshQueueCount();
    if (n) return { text:`未返信のコメントが ${n} 件あります。`, go:() => openQueuePage() };
  }
  const active = L.myCM.filter(m => m.paid_at).map(m => L.cohorts.find(c => c.id === m.cohort_id))
    .filter(c => c && c.status === 'active');
  for (const c of active) {
    const { data } = await supa.from('lessons').select('id, day_no, publish_at').eq('cohort_id', c.id)
      .not('publish_at', 'is', null).lte('publish_at', new Date().toISOString())
      .order('day_no', { ascending:false }).limit(1);
    const l = data?.[0];
    if (l) return { text:`${c.name} は今日 Day ${l.day_no} です。`, go:() => openLessonById(l.id, c) };
  }
  const upcoming = L.myCM.map(m => L.cohorts.find(c => c.id === m.cohort_id))
    .filter(c => c && c.starts_on && new Date(c.starts_on) > new Date())
    .sort((a,b) => a.starts_on.localeCompare(b.starts_on))[0];
  if (upcoming) return { text:`${upcoming.name} は ${fmtDateJ(upcoming.starts_on)} の朝から始まります。`, go:() => openLessonsRoom(cohortRoom(upcoming)) };
  return null;
}

/* ---------- 新着フィードに混ぜる「今日のレッスン」 ---------- */
async function lessonsFeedItems(){
  const ids = L.myCM.filter(m => m.paid_at).map(m => m.cohort_id);
  const editorIds = editorCohorts().map(c => c.id);
  const all = [...new Set([...ids, ...editorIds])];
  if (!all.length) return [];
  const { data } = await supa.from('lessons').select('id, cohort_id, day_no, title, publish_at')
    .in('cohort_id', all).not('publish_at', 'is', null).lte('publish_at', new Date().toISOString())
    .order('publish_at', { ascending:false }).limit(3);
  return (data || []).map(l => {
    const c = L.cohorts.find(x => x.id === l.cohort_id);
    return { t:l.publish_at, kind:'lesson', html:`
      <div class="feed-item feed-click" data-lesson-open="${l.id}">
        <div class="avatar" style="background:var(--ai)">${l.day_no}</div>
        <div class="feed-body">
          <div class="feed-meta">Day ${l.day_no} が公開されました<span class="room-chip">${esc(c?.name || '')}</span> ・ ${fmtWhen(l.publish_at)}</div>
          <div class="feed-text">${esc(l.title || `Day ${l.day_no}`)}</div>
        </div>
      </div>` };
  });
}
async function openLessonById(lessonId, cohort){
  const { data, error } = await supa.from('lessons').select('*').eq('id', lessonId).single();
  if (error || !data) return toast('この回はまだ読めません');
  const c = cohort || L.cohorts.find(x => x.id === data.cohort_id);
  L.cohort = c;
  await loadCohortLessons(c);
  openLesson(data);
}

/* ============================================================
   紹介ページ（入っていない部屋。visibility で分岐）
   ============================================================ */
async function openRoomAbout(room){
  leaveChat();
  S.current = { type:'room-about', room };
  $('room-title').textContent = room.name;
  $('tabs').innerHTML = '';
  updatePinBtn();
  highlightNav();
  const openC = L.cohorts.filter(c => c.room_id === room.id && c.status === 'open');
  const vis = room.visibility || 'invite';
  let h = `<div class="card about-card">
    <h2 class="about-title">${esc(room.name)}</h2>
    ${room.subtitle ? `<p class="about-sub">${esc(room.subtitle)}</p>` : ''}
    ${room.about_what ? `<div class="about-kv"><div class="k">ここで何をするか</div><div class="v">${richText(room.about_what)}</div></div>` : ''}
    ${room.about_who  ? `<div class="about-kv"><div class="k">誰が入っているか</div><div class="v">${richText(room.about_who)}</div></div>` : ''}
    ${room.about_how  ? `<div class="about-kv"><div class="k">入り方</div><div class="v">${richText(room.about_how)}</div></div>` : ''}
    ${!room.about_what && !room.about_who && !room.about_how ? `<p class="muted">紹介文は準備中です。</p>` : ''}
  </div>`;
  if (vis === 'public') {
    h += `<div class="card"><p style="font-size:13px;margin-bottom:12px">どなたでも入れます。</p><button class="primary-btn" id="about-join">参加する</button></div>`;
  } else if (openC.length) {
    h += openC.map(c => `
      <div class="card">
        <h3><span class="bar"></span>${esc(c.name)}${c.period_label ? `<span class="muted" style="margin-left:8px;font-weight:400">${esc(c.period_label)}</span>` : ''}<span class="pill-open" style="margin-left:auto">募集中</span></h3>
        ${c.starts_on ? `<div class="kv"><b>開始</b>${fmtDateJ(c.starts_on)}${c.total_sessions ? `（${c.total_sessions}日）` : ''}</div>` : ''}
        ${c.intake_to ? `<div class="kv"><b>申込期間</b>${c.intake_from ? fmtDateJ(c.intake_from) + ' 〜 ' : ''}${fmtDateJ(c.intake_to)}</div>` : ''}
        ${c.price_jpy != null ? `<div class="kv"><b>参加費</b>¥${Number(c.price_jpy).toLocaleString('ja-JP')}</div>` : ''}
        ${c.payment_info ? `<div class="kv stack"><b>お支払い</b><span>${richText(c.payment_info)}</span></div>` : ''}
        ${myCMFor(c.id)
          ? `<p class="muted" style="margin-top:8px">✓ 参加を受け付けました${myCMFor(c.id).paid_at ? '' : '（お支払いの確認待ち）'}</p>
             ${!myCMFor(c.id).paid_at && c.payment_url ? `<a class="zoom-btn" href="${esc(c.payment_url)}" target="_blank" rel="noopener">お支払いページを開く</a>` : ''}`
          : `<button class="primary-btn" style="margin-top:10px" data-cohort-join="${c.id}">${c.payment_url ? '申し込む' : '参加する'}</button>`}
      </div>`).join('');
  } else {
    h += `<div class="card">
      <div class="nocta">${esc(room.next_intake || 'いまは募集していません')}</div>
      <button class="ghost-btn" id="about-notify">募集が始まったら知らせる</button>
    </div>`;
  }
  $('page').innerHTML = h;
  const j = $('about-join'); if (j) j.onclick = () => joinPublicRoom(room.id);
  $('page').querySelectorAll('[data-cohort-join]').forEach(el => el.onclick = () => joinCohort(el.dataset.cohortJoin, room));
  const nb = $('about-notify');
  if (nb) {
    const { data } = await supa.from('room_notify_requests').select('room_id').eq('room_id', room.id).eq('user_id', S.user.id).maybeSingle();
    if (data) { nb.textContent = '✓ 募集が始まったら知らせます'; nb.classList.add('on'); }
    nb.onclick = async () => {
      if (nb.classList.contains('on')) {
        await supa.from('room_notify_requests').delete().eq('room_id', room.id).eq('user_id', S.user.id);
        nb.textContent = '募集が始まったら知らせる'; nb.classList.remove('on'); toast('取り消しました');
      } else {
        const { error } = await supa.from('room_notify_requests').insert({ room_id: room.id, user_id: S.user.id });
        if (error) return toast('登録に失敗しました：' + error.message);
        nb.textContent = '✓ 募集が始まったら知らせます'; nb.classList.add('on'); toast('募集が始まったらお知らせします');
      }
    };
  }
}
async function joinCohort(cohortId, room){
  const c = L.cohorts.find(x => x.id === cohortId);
  const { error } = await supa.from('cohort_members').insert({ cohort_id: cohortId, user_id: S.user.id });
  if (error) return toast('参加に失敗しました：' + error.message);
  const [{ data: ms }, { data: cm }] = await Promise.all([
    supa.from('memberships').select('*').eq('user_id', S.user.id),
    supa.from('cohort_members').select('*').eq('user_id', S.user.id),
  ]);
  S.memberships = ms || S.memberships; L.myCM = cm || L.myCM;
  L.editorRooms = S.memberships.filter(x => ['admin','editor'].includes(x.role)).map(x => x.room_id);
  renderNav(); renderMe();
  if (c?.payment_url) { window.open(c.payment_url, '_blank', 'noopener'); toast('参加を受け付けました。お支払いページを開きました'); }
  else toast('参加を受け付けました。お支払いのご案内をご確認ください');
  openRoom(room);
}

/* ============================================================
   21 Lessons の部屋：シリーズ一覧
   ============================================================ */
function openLessonsRoom(room, tab){
  leaveChat();
  S.current = { type:'room', room };
  $('room-title').textContent = room.name;
  updatePinBtn();
  const tabs = [['series','シリーズ'],['pinned','固定情報']];
  if (canEdit(room.id)) tabs.push(['cmembers','参加者・支払い確認']);
  if (roleIn(room.id) === 'admin') tabs.push(['members','権限']);
  $('tabs').innerHTML = tabs.map(([k,label]) => `<div class="tab" data-tab="${k}">${t(label)}</div>`).join('');
  $('tabs').querySelectorAll('.tab').forEach(el => el.onclick = () => showLessonsTab(el.dataset.tab));
  highlightNav();
  showLessonsTab(tab || 'series');
}
function showLessonsTab(tab){
  S.tab = tab;
  $('tabs').querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  ({ series: renderSeries, pinned: renderPinned, members: renderMembers, cmembers: renderCohortMembersAdmin })[tab]();
}
async function renderSeries(){
  const room = S.current.room;
  const editor = canEdit(room.id);
  const rc = L.cohorts.filter(c => c.room_id === room.id);
  const mine = rc.filter(c => myCMFor(c.id) || editor);
  const g = { active:[], open:[], past:[], draft:[] };
  mine.forEach(c => (g[c.status] || g.draft).push(c));
  const openNotMine = rc.filter(c => c.status === 'open' && !myCMFor(c.id) && !editor);
  const row = c => {
    const cm = myCMFor(c.id);
    const unpaid = cm && !cm.paid_at && !editor;
    return `<div class="lrow" data-cohort="${c.id}">
      <div class="lico ${c.status === 'past' ? 'plain' : ''}">${c.total_sessions || 21}</div>
      <div class="lmain">
        <div class="lt1">${esc(c.name)}${tagChips(c)}</div>
        <div class="lt2">${esc(c.period_label || '')}${c.status === 'past' ? '　受講済み・いつでも読み返せます' : ''}${unpaid ? '　<span style="color:var(--ai)">お支払いの確認待ち</span>' : ''}</div>
      </div>
      <div class="lright">${c.status === 'active' ? '<span class="pill-g">受講中</span>' : c.status === 'open' ? '<span class="pill-open">募集中</span>' : c.status === 'draft' ? '<span class="pill-g">準備中</span>' : '読み返す'}${editor ? `<button class="res-del" data-cedit="${c.id}" title="この期を編集" style="margin-left:4px">✏️</button>` : ''}</div>
    </div>`;
  };
  const sec = (t, a, e) => a.length ? `<div class="card"><h3><span class="bar"></span>${t}${e ? `<span class="muted" style="margin-left:auto;font-weight:400">${e}</span>` : ''}</h3>${a.map(row).join('')}</div>` : '';
  // タグで絞り込む（パーソナル／ビジネス／組織 など。期に付いたタグを集める）
  const allTags = [...new Set([...mine, ...openNotMine].flatMap(c => c.tags || []))];
  const tag = L.tagFilter && allTags.includes(L.tagFilter) ? L.tagFilter : null;
  L.tagFilter = tag;
  const byTag = a => tag ? a.filter(c => (c.tags || []).includes(tag)) : a;
  Object.keys(g).forEach(k => g[k] = byTag(g[k]));
  const openFiltered = byTag(openNotMine);
  let h = '';
  if (allTags.length) h += `<div class="filters">${['すべて', ...allTags].map(t => `<div class="chip ${(t === 'すべて' ? !tag : tag === t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</div>`).join('')}</div>`;
  if (editor) h += `<div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="add-res-btn" style="margin-bottom:0" id="go-post">✎ レッスンを出す</button>
      <button class="add-res-btn" style="margin-bottom:0" id="go-queue">↩ 未返信${L.queueCount ? `（${L.queueCount}）` : ''}</button>
      <button class="add-res-btn" style="margin-bottom:0" id="add-cohort">＋ 期を作る</button>
    </div>`;
  h += sec('受講中', g.active) + sec('募集中', g.open, '1日以降の途中参加もできます') + sec('これまでに受けた回', g.past) + (editor ? sec('準備中', g.draft) : '');
  if (openFiltered.length) h += `<div class="card"><h3><span class="bar"></span>募集中</h3>${openFiltered.map(c => `
      <div class="lrow" data-cohort-about="1">
        <div class="lico">${c.total_sessions || 21}</div>
        <div class="lmain"><div class="lt1">${esc(c.name)}${tagChips(c)}</div><div class="lt2">${esc(c.period_label || '')}${c.price_jpy != null ? `　¥${Number(c.price_jpy).toLocaleString('ja-JP')}` : ''}</div></div>
        <div class="lright"><span class="pill-open">募集中</span></div>
      </div>`).join('')}</div>`;
  if (!h.trim() || (!mine.length && !openNotMine.length)) {
    h += `<div class="card"><div class="empty">${rc.length ? 'まだ参加している回はありません' : '次の回は準備中です'}</div></div>`;
  }
  $('page').innerHTML = h;
  $('page').querySelectorAll('[data-tag]').forEach(el => el.onclick = () => { L.tagFilter = el.dataset.tag === 'すべて' ? null : el.dataset.tag; renderSeries(); });
  $('page').querySelectorAll('[data-cohort]').forEach(el => el.onclick = e => {
    if (e.target.closest('button')) return;
    openCohortDays(L.cohorts.find(c => c.id === el.dataset.cohort));
  });
  $('page').querySelectorAll('[data-cedit]').forEach(el => el.onclick = e => {
    e.stopPropagation(); openCohortModal(L.cohorts.find(c => c.id === el.dataset.cedit), room);
  });
  $('page').querySelectorAll('[data-cohort-about]').forEach(el => el.onclick = () => openRoomAbout(room));
  const gp = $('go-post'); if (gp) gp.onclick = () => openPostPage();
  const gq = $('go-queue'); if (gq) gq.onclick = () => openQueuePage();
  const ac = $('add-cohort'); if (ac) ac.onclick = () => openCohortModal(null, room);
}

const tagChips = c => (c.tags || []).map(t => `<span class="tagchip">${esc(t)}</span>`).join('');

/* ============================================================
   Day 一覧
   ============================================================ */
async function loadCohortLessons(c){
  const [{ data: ls, error }, { data: rd }, { data: pn }] = await Promise.all([
    supa.from('lessons').select('*').eq('cohort_id', c.id).order('day_no'),
    supa.from('lesson_reads').select('lesson_id').eq('user_id', S.user.id),
    supa.from('lesson_pins').select('target_type, target_id').eq('user_id', S.user.id),
  ]);
  if (error) throw error;
  L.lessons = ls || [];
  L.reads = {}; (rd || []).forEach(r => L.reads[r.lesson_id] = true);
  L.pins = {}; (pn || []).forEach(p => L.pins[p.target_type + ':' + p.target_id] = true);
}
async function openCohortDays(c){
  if (!c) return;
  const room = cohortRoom(c);
  leaveChat();
  L.cohort = c;
  S.current = { type:'cohort', room, cohort: c };
  $('room-title').textContent = c.name;
  $('tabs').innerHTML = `<div class="tab" data-tab="back">‹ ${esc(room?.name || 'シリーズ')}</div>`;
  $('tabs').querySelector('[data-tab="back"]').onclick = () => openLessonsRoom(room);
  updatePinBtn(); highlightNav();
  $('page').innerHTML = `<div class="empty">読み込み中…</div>`;
  const editor = canEditCohort(c);
  const cm = myCMFor(c.id);
  if (!editor && !cm?.paid_at) {
    $('page').innerHTML = `<div class="card"><h3><span class="bar"></span>${esc(c.name)}</h3>
      <p style="font-size:13px">お支払いの確認ができると、ここに毎朝のレッスンが並びます。</p>
      ${c.price_jpy != null ? `<div class="kv" style="margin-top:10px"><b>参加費</b>¥${Number(c.price_jpy).toLocaleString('ja-JP')}</div>` : ''}
      ${c.payment_info ? `<div class="kv stack"><b>お支払い</b><span>${richText(c.payment_info)}</span></div>` : ''}
      ${c.payment_url ? `<a class="zoom-btn" href="${esc(c.payment_url)}" target="_blank" rel="noopener">お支払いページを開く</a>` : ''}
    </div>`;
    return;
  }
  try { await loadCohortLessons(c); } catch (e) { $('page').innerHTML = errBox(e); return; }
  if (S.current.cohort !== c) return;
  drawDays();
}
function drawDays(){
  const c = L.cohort, editor = canEditCohort(c);
  const now = Date.now();
  const total = c.total_sessions || 21;
  const published = L.lessons.filter(l => l.publish_at && new Date(l.publish_at).getTime() <= now);
  const maxDay = published.reduce((m, l) => Math.max(m, l.day_no), 0);
  const readCount = published.filter(l => L.reads[l.id]).length;
  let rows = '';
  const shown = editor ? L.lessons : published;
  shown.forEach(l => {
    const isPub = l.publish_at && new Date(l.publish_at).getTime() <= now;
    const state = !l.publish_at ? '<span class="pill-g">下書き</span>' : !isPub ? `<span class="pill-g">${fmtWhen(l.publish_at)} に出ます</span>` : (editor ? '' : L.reads[l.id] ? '<span class="muted">読了</span>' : '<span class="pill-open">未読</span>');
    rows += `<div class="lrow" data-lesson="${l.id}">
      <div class="lico ${isPub ? '' : 'plain'}">${l.day_no}</div>
      <div class="lmain"><div class="lt1">${esc(l.title || `Day ${l.day_no}`)}</div><div class="lt2">${isPub ? fmtWhen(l.publish_at) + ' 公開' : (l.body ? `${l.body.length}文字` : '本文なし')}</div></div>
      <div class="lright">${L.pins['lesson:' + l.id] ? '<span style="color:var(--ai)">★</span> ' : ''}${state}${editor ? `<button class="res-del" data-ledit="${l.id}" title="編集" style="margin-left:4px">✏️</button>` : ''}</div>
    </div>`;
  });
  if (!editor) {
    const next = maxDay + 1;
    if (next <= total && c.status !== 'past') {
      rows += `<div class="lrow dim"><div class="lico plain">${next}</div><div class="lmain"><div class="lt1">Day ${next}</div><div class="lt2">明日</div></div></div>`;
      if (total - next > 0) rows += `<div class="lrow dim" style="border:none"><div class="lico plain">…</div><div class="lmain"><div class="lt2">残り ${total - next} 日</div></div></div>`;
    }
  } else if (L.lessons.length < total) {
    rows += `<div class="lrow dim" data-newday="1" style="cursor:pointer"><div class="lico plain">＋</div><div class="lmain"><div class="lt1">Day ${nextDayNo(c)} を書く</div><div class="lt2">残り ${total - L.lessons.length} 回</div></div></div>`;
  }
  const empty = !L.lessons.length && !editor
    ? `<div class="empty">${c.starts_on && new Date(c.starts_on) > new Date() ? `${fmtDateJ(c.starts_on)} の朝から始まります` : 'まだレッスンはありません。最初の回をお待ちください'}</div>` : '';
  $('page').innerHTML = `
    ${editor ? `<div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="add-res-btn" style="margin-bottom:0" id="c-edit">✏️ この期を編集</button>
    </div>` : ''}
    <div class="card">
      <h3><span class="bar"></span>${total}日のレッスン<span class="muted" style="margin-left:auto;font-weight:400">${published.length}／${total} 公開${!editor && published.length ? `　読了 ${readCount}` : ''}</span></h3>
      ${published.length ? `<div class="prog"><i style="width:${Math.round(published.length / total * 100)}%"></i></div>` : ''}
      ${rows}${empty}
    </div>`;
  $('page').querySelectorAll('[data-lesson]').forEach(el => el.onclick = e => {
    if (e.target.closest('button')) return;
    openLesson(L.lessons.find(l => l.id === el.dataset.lesson));
  });
  $('page').querySelectorAll('[data-ledit]').forEach(el => el.onclick = e => { e.stopPropagation(); openPostPage(L.lessons.find(l => l.id === el.dataset.ledit), c); });
  const nd = $('page').querySelector('[data-newday]'); if (nd) nd.onclick = () => { L.postDraft = null; openPostPage(null, c, true); };
  const ce = $('c-edit'); if (ce) ce.onclick = () => openCohortModal(c, cohortRoom(c));
}
const nextDayNo = c => (L.lessons.filter(l => l.cohort_id === c.id).reduce((m, l) => Math.max(m, l.day_no), 0) + 1);

/* ============================================================
   本文（回）
   ============================================================ */
async function lessonImageUrl(path){
  if (!path) return '';
  const { data } = await supa.storage.from('lesson-images').createSignedUrl(path, 3600);
  return data?.signedUrl || '';
}
async function openLesson(l, opts = {}){
  if (!l) return;
  const c = L.cohort && L.cohort.id === l.cohort_id ? L.cohort : L.cohorts.find(x => x.id === l.cohort_id);
  L.cohort = c;
  const room = cohortRoom(c);
  leaveChat();
  S.current = { type:'lesson', room, cohort: c, lesson: l };
  $('room-title').textContent = c?.name || '';
  $('tabs').innerHTML = `<div class="tab" data-tab="back">‹ Day 一覧</div>`;
  $('tabs').querySelector('[data-tab="back"]').onclick = () => openCohortDays(c);
  updatePinBtn(); highlightNav();
  $('page').innerHTML = `<div class="empty">読み込み中…</div>`;
  const editor = canEditCohort(c);
  const [{ data: cms, error }, { data: rx }, { data: pn }, img] = await Promise.all([
    supa.from('lesson_comments').select('*').eq('lesson_id', l.id).order('created_at'),
    supa.from('lesson_reactions').select('*').eq('target_type', 'lesson').eq('target_id', l.id),
    supa.from('lesson_pins').select('target_type, target_id').eq('user_id', S.user.id),
    lessonImageUrl(l.image_path),
  ]);
  if (S.current.lesson !== l) return;
  if (error) { $('page').innerHTML = errBox(error); return; }
  const comments = cms || [];
  L.pins = {}; (pn || []).forEach(p => L.pins[p.target_type + ':' + p.target_id] = true);
  // コメントへのいいねも取る
  let crx = [];
  if (comments.length) {
    const { data } = await supa.from('lesson_reactions').select('*').eq('target_type', 'comment').in('target_id', comments.map(x => x.id));
    crx = data || [];
  }
  const editors = await editorIdsFor(c.room_id);
  await ensureNames([...comments.map(x => x.user_id), ...(rx || []).map(x => x.user_id), ...crx.map(x => x.user_id)]);
  // 既読
  if (!L.reads[l.id]) { supa.from('lesson_reads').upsert({ user_id: S.user.id, lesson_id: l.id }).then(() => { L.reads[l.id] = true; }); }

  const likes = rx || [];
  const iLike = likes.some(x => x.user_id === S.user.id);
  const likeNames = likes.map(x => S.profilesCache[x.user_id]).filter(Boolean);
  const pinned = !!L.pins['lesson:' + l.id];
  const top = comments.filter(x => !x.parent_id);
  const replies = id => comments.filter(x => x.parent_id === id);

  const cmHtml = x => {
    const del = !!x.deleted_at;
    const mine = x.user_id === S.user.id;
    const isEd = editors.includes(x.user_id);
    const my = crx.filter(r => r.target_id === x.id);
    const liked = my.some(r => r.user_id === S.user.id);
    const cp = !!L.pins['comment:' + x.id];
    return `<div class="cbody">
      <div class="cwho">${esc(S.profilesCache[x.user_id] || '…')}${isEd ? '<span class="cwho-ed">担当</span>' : ''}<span>${fmtWhen(x.created_at)}</span></div>
      <div class="ctext ${del ? 'cdel' : ''}">${del ? '（削除されました）' : nl2br(x.body)}</div>
      ${del ? '' : `<div class="ctools">
        <button data-clike="${x.id}" class="${liked ? 'on' : ''}">♡ ${my.length || ''} いいね</button>
        ${!x.parent_id ? `<button data-creply="${x.id}">↩ 返信</button>` : ''}
        <button data-cpin="${x.id}" class="${cp ? 'on' : ''}">${cp ? '★ ピン済み' : '☆ ピン'}</button>
        ${(mine || editor) ? `<button data-cdel="${x.id}">削除</button>` : ''}
      </div>`}
    </div>`;
  };
  const threadHtml = top.length ? top.map(x => {
    const rs = replies(x.id);
    const unans = editor && !x.deleted_at && !rs.some(r => editors.includes(r.user_id)) && !editors.includes(x.user_id);
    return `<div class="cm" id="c-${x.id}">
      <div class="avatar cav">${esc(initialOf(S.profilesCache[x.user_id]))}</div>
      <div style="flex:1;min-width:0">
        ${cmHtml(x)}
        ${rs.map(r => `<div class="rep ${editors.includes(r.user_id) ? 'rep-ed' : ''}"><div class="cm" style="padding:0;border:none;margin:0"><div class="avatar cav ${editors.includes(r.user_id) ? 'cav-ed' : ''}">${esc(initialOf(S.profilesCache[r.user_id]))}</div><div style="flex:1;min-width:0">${cmHtml(r)}</div></div></div>`).join('')}
        ${unans ? `<div class="unans">まだ返していません</div>` : ''}
        <div class="reply-slot" id="rs-${x.id}"></div>
      </div>
    </div>`;
  }).join('') : `<div class="empty" style="padding:18px 0">まだコメントがありません。最初のひとことをどうぞ。</div>`;

  $('page').innerHTML = `
    <div class="card lesson-card">
      ${img ? `<img class="lesson-img" src="${img}" alt="">` : ''}
      <div class="ltitle">Day ${l.day_no}${l.title ? `　${esc(l.title)}` : ''}</div>
      <div class="lmeta">${esc(c?.name || '')} ・ ${l.publish_at ? fmtWhen(l.publish_at) + ' 公開' : '下書き'}${editor ? `　<a href="#" id="l-edit">編集する</a>` : ''}</div>
      <div class="ltext">${richText(l.body || '')}</div>
      <div class="acts">
        <button class="act ${iLike ? 'on' : ''}" id="l-like">♡ ${likes.length || ''} いいね</button>
        <button class="act ${pinned ? 'on' : ''}" id="l-pin">${pinned ? '★ ピン済み' : '☆ あとで見返す'}</button>
      </div>
      ${likeNames.length ? `<div class="likenames">${likeNames.slice(0, 6).map(n => esc(n) + 'さん').join('、')}${likeNames.length > 6 ? `、ほか${likeNames.length - 6}人` : ''}</div>` : ''}
    </div>
    <div class="card">
      <h3><span class="bar"></span>コメント<span class="muted" style="margin-left:auto;font-weight:400">${top.length}件</span></h3>
      ${threadHtml}
      <div class="composer" id="composer">
        <textarea class="cinput" id="cin" rows="1" placeholder="${editor ? '返信やコメントを書く…' : '質問やコメントを書く…'}"></textarea>
        <button class="send" id="csend">↑</button>
      </div>
    </div>`;

  const cin = $('cin');
  const grow = ta => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
  cin.oninput = () => grow(cin);
  const post = async (body, parentId, ta) => {
    if (!body.trim()) return;
    const { error } = await supa.from('lesson_comments').insert({ lesson_id: l.id, user_id: S.user.id, parent_id: parentId || null, body: body.trim() });
    if (error) return toast('送信に失敗しました：' + error.message);
    if (ta) ta.value = '';
    toast(parentId ? '返信しました' : 'コメントを送りました');
    if (editor) refreshQueueCount();
    openLesson(l);
  };
  $('csend').onclick = () => post(cin.value, null, cin);
  cin.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(cin.value, null, cin); };
  $('l-like').onclick = () => toggleReaction('lesson', l.id, iLike).then(() => openLesson(l));
  $('l-pin').onclick = () => togglePin('lesson', l.id).then(() => openLesson(l));
  const le = $('l-edit'); if (le) le.onclick = e => { e.preventDefault(); openPostPage(l, c); };
  $('page').querySelectorAll('[data-clike]').forEach(el => el.onclick = () => toggleReaction('comment', el.dataset.clike, el.classList.contains('on')).then(() => openLesson(l)));
  $('page').querySelectorAll('[data-cpin]').forEach(el => el.onclick = () => togglePin('comment', el.dataset.cpin).then(() => openLesson(l)));
  $('page').querySelectorAll('[data-cdel]').forEach(el => el.onclick = async () => {
    if (!confirm('このコメントを削除しますか？')) return;
    const { error } = await supa.from('lesson_comments').update({ deleted_at: new Date().toISOString() }).eq('id', el.dataset.cdel);
    if (error) return toast('削除に失敗しました：' + error.message);
    openLesson(l);
  });
  const openReply = id => {
    const slot = $('rs-' + id); if (!slot) return;
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<div class="composer" style="margin-top:8px;border:none;padding-top:0"><textarea class="cinput" rows="1" placeholder="返信を書く…" id="rin-${id}"></textarea><button class="send" id="rsend-${id}">↑</button></div>`;
    const ta = $('rin-' + id); ta.focus(); ta.oninput = () => grow(ta);
    ta.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(ta.value, id, ta); };
    $('rsend-' + id).onclick = () => post(ta.value, id, ta);
  };
  $('page').querySelectorAll('[data-creply]').forEach(el => el.onclick = () => openReply(el.dataset.creply));
  if (opts.replyTo) { openReply(opts.replyTo); const el = $('c-' + opts.replyTo); if (el) el.scrollIntoView({ block:'center' }); }
  else if (opts.scrollTo) { const el = $('c-' + opts.scrollTo); if (el) el.scrollIntoView({ block:'center' }); }
  else document.querySelector('.content').scrollTop = 0;
}
async function toggleReaction(type, id, on){
  const q = on
    ? supa.from('lesson_reactions').delete().eq('target_type', type).eq('target_id', id).eq('user_id', S.user.id)
    : supa.from('lesson_reactions').insert({ target_type: type, target_id: id, user_id: S.user.id });
  const { error } = await q;
  if (error) toast('更新に失敗しました：' + error.message);
}
async function togglePin(type, id){
  const key = type + ':' + id, on = !!L.pins[key];
  const q = on
    ? supa.from('lesson_pins').delete().eq('target_type', type).eq('target_id', id).eq('user_id', S.user.id)
    : supa.from('lesson_pins').insert({ target_type: type, target_id: id, user_id: S.user.id });
  const { error } = await q;
  if (error) return toast('更新に失敗しました：' + error.message);
  L.pins[key] = !on;
  toast(on ? 'ピンを外しました' : 'ピンしました。左の「ピンした場所」に集まります');
}
const _editorsCache = {};
async function editorIdsFor(roomId){
  if (_editorsCache[roomId]) return _editorsCache[roomId];
  const { data } = await supa.from('memberships').select('user_id, role').eq('room_id', roomId).in('role', ['editor','admin']);
  const ids = (data || []).map(x => x.user_id);
  if (!ids.length && canEdit(roomId)) ids.push(S.user.id);
  _editorsCache[roomId] = ids;
  return ids;
}

/* ============================================================
   ピンした場所
   ============================================================ */
async function openPinsPage(){
  leaveChat();
  S.current = { type:'pins' };
  $('room-title').textContent = 'ピンした場所';
  $('tabs').innerHTML = '';
  updatePinBtn(); highlightNav();
  $('page').innerHTML = `<div class="empty">読み込み中…</div>`;
  const { data: pins, error } = await supa.from('lesson_pins').select('*').eq('user_id', S.user.id).order('created_at', { ascending:false });
  if (error) { $('page').innerHTML = errBox(error); return; }
  const lids = (pins || []).filter(p => p.target_type === 'lesson').map(p => p.target_id);
  const cids = (pins || []).filter(p => p.target_type === 'comment').map(p => p.target_id);
  const [ls, cs] = await Promise.all([
    lids.length ? supa.from('lessons').select('*').in('id', lids) : { data: [] },
    cids.length ? supa.from('lesson_comments').select('*, lessons(id, day_no, title, cohort_id)').in('id', cids) : { data: [] },
  ]);
  const lessons = ls.data || [], comments = cs.data || [];
  await ensureNames(comments.map(c => c.user_id));
  if (!lessons.length && !comments.length) {
    $('page').innerHTML = `<div class="card"><div class="empty">まだ何もピンしていません。<br>レッスンや、誰かの発言の ☆ を押すと、ここに集まります。</div></div>`;
    return;
  }
  const cname = id => L.cohorts.find(c => c.id === id)?.name || '';
  let h = '';
  if (lessons.length) h += `<div class="card"><h3><span class="bar"></span>レッスン</h3>${lessons.map(l => `
    <div class="lrow" data-plesson="${l.id}"><div class="lico">${l.day_no}</div>
      <div class="lmain"><div class="lt1">${esc(l.title || `Day ${l.day_no}`)}</div><div class="lt2">${esc(cname(l.cohort_id))} ・ Day ${l.day_no}</div></div>
      <div class="lright" style="color:var(--ai)">★</div></div>`).join('')}</div>`;
  if (comments.length) h += `<div class="card"><h3><span class="bar"></span>誰かの発言・自分の質問</h3>${comments.map(c => `
    <div class="lrow" data-pcomment="${c.id}" data-plesson2="${c.lesson_id}"><div class="avatar cav">${esc(initialOf(S.profilesCache[c.user_id]))}</div>
      <div class="lmain"><div class="lt1">${esc(S.profilesCache[c.user_id] || '…')}</div><div class="lt2">${esc((c.body || '').slice(0, 60))}${(c.body || '').length > 60 ? '…' : ''}</div>
      <div class="lt2">${esc(cname(c.lessons?.cohort_id))} ・ Day ${c.lessons?.day_no ?? ''}</div></div>
      <div class="lright" style="color:var(--ai)">★</div></div>`).join('')}</div>`;
  $('page').innerHTML = h;
  $('page').querySelectorAll('[data-plesson]').forEach(el => el.onclick = () => openLessonById(el.dataset.plesson));
  $('page').querySelectorAll('[data-pcomment]').forEach(el => el.onclick = async () => {
    const { data } = await supa.from('lessons').select('*').eq('id', el.dataset.plesson2).single();
    if (!data) return toast('この回はいま読めません');
    L.cohort = L.cohorts.find(c => c.id === data.cohort_id);
    openLesson(data, { scrollTo: el.dataset.pcomment });
  });
}

/* ============================================================
   未返信キュー（editor 以上）
   ============================================================ */
async function fetchQueue(){
  const cs = editorCohorts();
  if (!cs.length) return [];
  const { data: ls } = await supa.from('lessons').select('id, day_no, title, cohort_id').in('cohort_id', cs.map(c => c.id));
  const lessons = ls || [];
  if (!lessons.length) return [];
  const { data: cms } = await supa.from('lesson_comments').select('*').in('lesson_id', lessons.map(l => l.id)).is('deleted_at', null).order('created_at');
  const comments = cms || [];
  const roomIds = [...new Set(cs.map(c => c.room_id))];
  const eds = new Set();
  for (const rid of roomIds) (await editorIdsFor(rid)).forEach(id => eds.add(id));
  return comments.filter(x => !x.parent_id && !eds.has(x.user_id)
      && !comments.some(r => r.parent_id === x.id && eds.has(r.user_id)))
    .map(x => ({ c: x, lesson: lessons.find(l => l.id === x.lesson_id) }));
}
async function openQueuePage(){
  leaveChat();
  S.current = { type:'queue' };
  $('room-title').textContent = '未返信';
  $('tabs').innerHTML = '';
  updatePinBtn(); highlightNav();
  $('page').innerHTML = `<div class="empty">読み込み中…</div>`;
  const q = await fetchQueue();
  L.queueCount = q.length; refreshQueueBadge();
  await ensureNames(q.map(x => x.c.user_id));
  const cname = id => L.cohorts.find(c => c.id === id)?.name || '';
  $('page').innerHTML = q.length ? `<div class="card"><h3><span class="bar"></span>まだ返していないコメント<span class="muted" style="margin-left:auto;font-weight:400">古い順</span></h3>
    ${q.map(({ c, lesson }) => `<div class="lrow" data-q="${c.id}" data-ql="${lesson.id}">
      <div class="avatar cav">${esc(initialOf(S.profilesCache[c.user_id]))}</div>
      <div class="lmain"><div class="lt2" style="color:var(--ai);font-weight:600">${esc(cname(lesson.cohort_id))} ・ Day ${lesson.day_no}${lesson.title ? ' ' + esc(lesson.title) : ''}</div>
        <div class="lt1">${esc(S.profilesCache[c.user_id] || '…')}</div>
        <div class="lt2" style="white-space:pre-wrap">${esc(c.body)}</div></div>
      <div class="lright">${fmtWhen(c.created_at)}</div></div>`).join('')}</div>`
    : `<div class="card"><div class="empty">未返信はありません。<br>全部返し終えました。</div></div>`;
  $('page').querySelectorAll('[data-q]').forEach(el => el.onclick = async () => {
    const { data } = await supa.from('lessons').select('*').eq('id', el.dataset.ql).single();
    if (!data) return;
    L.cohort = L.cohorts.find(c => c.id === data.cohort_id);
    openLesson(data, { replyTo: el.dataset.q });
  });
}
/* 未返信の件数は、サイドバーの 21 Lessons の行に出す（editor 以上にだけ見えます） */
function refreshQueueBadge(){
  const b = document.querySelector('[data-queue-badge]');
  if (b && L.queueCount) { b.textContent = L.queueCount; return; }
  renderNav(); highlightNav();
}

/* ============================================================
   入稿（Danna・iPhone 前提）
   ============================================================ */
function tomorrow6amJST(){
  const p = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const g = t => Number(p.find(x => x.type === t).value);
  return new Date(Date.UTC(g('year'), g('month') - 1, g('day') + 1, 6 - 9, 0, 0)).toISOString();   // 翌日 06:00 JST
}
/* 1行目をタイトル、2行目以降を本文として扱う */
const splitTB = v => {
  const i = v.indexOf('\n');
  return i < 0 ? { t: v.trim(), b: '' } : { t: v.slice(0, i).trim(), b: v.slice(i + 1).replace(/^\n+/, '') };
};
const joinTB = (t, b) => (t ? t + (b ? '\n\n' + b : '') : (b || ''));
const hasContent = d => !!((d.title || '').trim() || (d.body || '').trim());
const postCountHint = d => (d.title || '').trim()
  ? `1行目がタイトルになります：<b>${esc(d.title.trim())}</b>` + ((d.body || '').trim() ? `　／　本文 ${d.body.trim().length}文字` : '　／　本文はまだありません')
  : '1行目にタイトル、2行目から本文。長押し → ペーストで入ります';

async function openPostPage(lesson, cohort, forceNew){
  const cs = editorCohorts().filter(c => c.status !== 'past');
  if (!cs.length && !lesson) {
    leaveChat(); S.current = { type:'post' }; $('room-title').textContent = 'レッスンを出す'; $('tabs').innerHTML = ''; updatePinBtn(); highlightNav();
    $('page').innerHTML = `<div class="card"><div class="empty">出せる期がまだありません。<br>21 Lessons の「シリーズ」から「期を作る」で作ってください。</div></div>`;
    return;
  }
  const c = cohort || (lesson ? L.cohorts.find(x => x.id === lesson.cohort_id) : (cs.find(x => x.status === 'active') || cs[0]));
  if (!lesson) {
    L.cohort = c;
    try { await loadCohortLessons(c); } catch (_) {}   // Day 番号を正しく出すために毎回読む
    // 書きかけ（まだ出していない回）があれば、新規ではなくその続きを開く
    const drafts = L.lessons.filter(l => l.cohort_id === c.id && !l.publish_at).sort((a, b) => a.day_no - b.day_no);
    if (drafts.length && !forceNew) lesson = drafts[drafts.length - 1];
  }
  const d = L.postDraft && L.postDraft.lessonId === (lesson?.id || null) && L.postDraft.cohortId === c.id ? L.postDraft : {
    lessonId: lesson?.id || null, cohortId: c.id,
    day: lesson?.day_no || nextDayNo(c),
    title: lesson?.title || '', body: lesson?.body || '',
    imagePath: lesson?.image_path || null, imageUrl: null,
    when: lesson?.publish_at ? 'keep' : 'now', publishAt: lesson?.publish_at || null,
    savedAt: null, dirty: false,
  };
  L.postDraft = d;
  leaveChat();
  S.current = { type:'post', cohort: c, lesson };
  $('room-title').textContent = lesson ? `${c.name} ・ Day ${lesson.day_no}` : 'レッスンを出す';
  const backRoom = cohortRoom(c);
  $('tabs').innerHTML = `<div class="tab" data-tab="back">‹ ${esc(c.name)}</div>`;
  $('tabs').querySelector('[data-tab="back"]').onclick = () => { L.postDraft = null; openCohortDays(c); };
  updatePinBtn(); highlightNav();
  if (d.imagePath && !d.imageUrl) d.imageUrl = await lessonImageUrl(d.imagePath);
  const isPublished = lesson?.publish_at && new Date(lesson.publish_at) <= new Date();
  const whenLabel = { now:'出す', am:'明朝 6:00 に出す', keep: isPublished ? '更新する' : '保存する' };
  $('page').innerHTML = `
    <div class="postbar">
      <div class="postbar-t">${lesson ? (lesson.publish_at ? `Day ${d.day} を編集` : `Day ${d.day}（下書き）`) : 'レッスンを出す'}</div>
      <span class="postbar-saved" id="p-saved">${d.savedAt ? '下書きを保存しました ' + d.savedAt : '書いたものは自動で保存されます'}</span>
      <button class="postbar-go" id="p-go" ${hasContent(d) ? '' : 'disabled'}>${whenLabel[d.when]}</button>
    </div>
    <div class="card postcard">
      <div class="ctx">
        <span>${esc(c.name)} ・ Day ${d.day}</span>
        ${!lesson && cs.length > 1 ? `<select id="p-cohort" class="ctx-sel">${cs.map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}
        <input type="number" id="p-day" class="ctx-day" value="${d.day}" min="1" max="99" title="Day">
      </div>
      <label class="plabel">レッスン</label>
      <textarea class="pinput ptext" id="p-body" placeholder="1行目にタイトル、2行目から本文を書いてください。&#10;ChatGPT からコピーして、そのまま貼るだけでも大丈夫です。">${esc(joinTB(d.title, d.body))}</textarea>
      <div class="phint" id="p-count">${postCountHint(d)}</div>
      <label class="plabel">インフォグラフィック</label>
      <div id="p-imgwrap">${d.imageUrl
        ? `<div class="pthumb"><img src="${d.imageUrl}" alt=""><button class="prm" id="p-rmimg">外す</button></div>`
        : `<div class="ppick"><button id="p-lib"><span>▣</span>写真から選ぶ</button><button id="p-cam"><span>◉</span>その場で撮る</button></div>
           <div class="phint">ChatGPT で作った画像を写真に保存しておけば、ここから選べます</div>`}
      </div>
      <input type="file" id="p-file" accept="image/*" style="display:none">
      <span class="phint" id="p-imgstatus"></span>
      <label class="plabel">いつ出すか</label>
      <div class="pseg">
        ${lesson?.publish_at ? `<button data-w="keep" class="${d.when === 'keep' ? 'on' : ''}">${isPublished ? 'そのまま更新' : fmtWhen(lesson.publish_at) + ' のまま'}</button>` : ''}
        <button data-w="now" class="${d.when === 'now' ? 'on' : ''}">今すぐ出す</button>
        <button data-w="am" class="${d.when === 'am' ? 'on' : ''}">明朝 6:00 に出す</button>
      </div>
      <div class="phint">${d.when === 'now' ? '押した瞬間に、参加者の画面に出ます' : d.when === 'am' ? '前の晩に書けたときだけ使います。朝6時に自動で出ます' : '公開のタイミングは変えません'}</div>
      <button class="pbig" id="p-go2" ${hasContent(d) ? '' : 'disabled'}>${whenLabel[d.when]}</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="ghost-btn" id="p-back">${esc(c.name)} の一覧へ</button>
        ${lesson ? `<button class="ghost-btn" id="p-new">＋ 新しい回を書く</button>` : ''}
        ${lesson ? `<button class="ghost-btn" id="p-del">この回を削除する</button>` : ''}
      </div>
    </div>`;

  const bd = $('p-body'), dy = $('p-day');
  const grow = () => { bd.style.height = 'auto'; bd.style.height = Math.max(180, bd.scrollHeight) + 'px'; };
  grow();
  const sync = () => {
    const ok = hasContent(d);
    $('p-go').disabled = !ok; $('p-go2').disabled = !ok;
    $('p-count').innerHTML = postCountHint(d);
  };
  let saveTimer = null;
  const markDirty = () => { d.dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 1200); };
  bd.oninput = () => { const st = splitTB(bd.value); d.title = st.t; d.body = st.b; grow(); sync(); markDirty(); };
  dy.onchange = () => { d.day = Number(dy.value) || d.day; markDirty(); };
  const sel = $('p-cohort'); if (sel) sel.onchange = () => { L.postDraft = null; openPostPage(null, L.cohorts.find(x => x.id === sel.value)); };
  $('page').querySelectorAll('[data-w]').forEach(b => b.onclick = () => { d.when = b.dataset.w; openPostPage(lesson, c); });
  const f = $('p-file');
  const pick = cap => { if (cap) f.setAttribute('capture', 'environment'); else f.removeAttribute('capture'); f.click(); };
  const pl = $('p-lib'), pc = $('p-cam'); if (pl) pl.onclick = () => pick(false); if (pc) pc.onclick = () => pick(true);
  f.onchange = async () => {
    const file = f.files && f.files[0]; if (!file) return;
    $('p-imgstatus').textContent = '画像を整えています…';
    try {
      const blob = await reencodeImage(file);
      const path = `${c.id}/${Date.now()}.jpg`;
      $('p-imgstatus').textContent = 'アップロード中…';
      const { error } = await supa.storage.from('lesson-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      d.imagePath = path; d.imageUrl = URL.createObjectURL(blob);
      $('p-imgstatus').textContent = '';
      markDirty(); openPostPage(lesson, c);
    } catch (e) {
      $('p-imgstatus').textContent = '';
      toast('画像を入れられませんでした：' + (e.message || e));
    }
    f.value = '';
  };
  const rm = $('p-rmimg'); if (rm) rm.onclick = () => { d.imagePath = null; d.imageUrl = null; markDirty(); openPostPage(lesson, c); };
  const go = () => publishLesson(lesson, c);
  $('p-go').onclick = go; $('p-go2').onclick = go;
  const bk = $('p-back'); if (bk) bk.onclick = () => { L.postDraft = null; openCohortDays(c); };
  const nw = $('p-new'); if (nw) nw.onclick = () => { L.postDraft = null; openPostPage(null, c, true); };
  const del = $('p-del'); if (del) del.onclick = async () => {
    if (!confirm(`Day ${lesson.day_no} を削除しますか？コメントも一緒に消えます。`)) return;
    const { error } = await supa.from('lessons').delete().eq('id', lesson.id);
    if (error) return toast('削除に失敗しました：' + error.message);
    L.postDraft = null; toast('削除しました'); openCohortDays(c);
  };
  document.querySelector('.content').scrollTop = 0;

  async function saveDraft(){
    if (!d.dirty) return;
    const row = { cohort_id: c.id, day_no: d.day, title: d.title.trim() || null, body: d.body.trim() || null, image_path: d.imagePath };
    let q;
    if (d.lessonId) q = supa.from('lessons').update(row).eq('id', d.lessonId).select().single();
    else if (d.body.trim() || d.title.trim()) q = supa.from('lessons').insert({ ...row, publish_at: null }).select().single();
    else return;
    const { data, error } = await q;
    if (error) { const s = $('p-saved'); if (s) s.textContent = '保存できませんでした：' + (error.code === '23505' ? `Day ${d.day} はすでにあります` : error.message); return; }
    d.lessonId = data.id; d.dirty = false;
    d.savedAt = new Date().toLocaleTimeString('ja-JP', { ...JST, hour:'2-digit', minute:'2-digit' });
    const s = $('p-saved'); if (s) s.textContent = '下書きを保存しました ' + d.savedAt;
    const i = L.lessons.findIndex(x => x.id === data.id); if (i >= 0) L.lessons[i] = data; else if (L.cohort?.id === c.id) L.lessons.push(data);
  }
  async function publishLesson(){
    if (!hasContent(d)) return;
    clearTimeout(saveTimer);
    const publish_at = d.when === 'now' ? new Date().toISOString() : d.when === 'am' ? tomorrow6amJST() : d.publishAt;
    const row = { cohort_id: c.id, day_no: d.day, title: d.title.trim() || null, body: d.body.trim() || null, image_path: d.imagePath, publish_at };
    const { data, error } = d.lessonId
      ? await supa.from('lessons').update(row).eq('id', d.lessonId).select().single()
      : await supa.from('lessons').insert(row).select().single();
    if (error) return toast('出せませんでした：' + (error.code === '23505' ? `Day ${d.day} はすでにあります` : error.message));
    L.postDraft = null;
    const i = L.lessons.findIndex(x => x.id === data.id); if (i >= 0) L.lessons[i] = data; else if (L.cohort?.id === c.id) L.lessons.push(data);
    $('page').innerHTML = `<div class="card done">
      <div class="mk">✓</div>
      <h2>${d.when === 'am' ? '明朝 6:00 に出ます' : `Day ${data.day_no} を出しました`}</h2>
      <p>${d.when === 'am' ? 'いま書いたものは保存されています。<br>朝6時に自動で出ます。それまでは直せます。' : '参加者の画面に並びました。<br>コメントが付くと「未返信」に入ります。'}</p>
      <div class="sub"><b>${esc(data.title || '（タイトルなし）')}</b><br>本文 ${(data.body || '').length}文字${data.image_path ? '　／　画像 1枚' : '　／　画像なし'}<br>${esc(c.name)} ・ Day ${data.day_no}</div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px">
        <button class="add-res-btn" style="margin:0" id="d-next">次の回を書く</button>
        <button class="add-res-btn" style="margin:0" id="d-list">Day 一覧へ</button>
      </div></div>`;
    $('d-next').onclick = () => openPostPage(null, c);
    $('d-list').onclick = () => openCohortDays(c);
  }
}
/* HEIC などをブラウザ内で JPEG に。長辺 1600px、品質 0.85 */
async function reencodeImage(file){
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch (_) {
    bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('この画像形式は開けませんでした。スクリーンショットか JPEG でお試しください')); im.src = URL.createObjectURL(file); });
  }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('変換できませんでした');
  return blob;
}

/* ============================================================
   期の作成・編集（editor 以上）
   ============================================================ */
function openCohortModal(c, room){
  const m = $('cohort-modal');
  $('ch-modal-title').textContent = c ? '期を編集' : '期を作る';
  $('ch-name').value = c?.name || '';
  $('ch-period').value = c?.period_label || '';
  $('ch-starts').value = c?.starts_on || '';
  $('ch-total').value = c?.total_sessions || 21;
  $('ch-from').value = c?.intake_from || '';
  $('ch-to').value = c?.intake_to || '';
  $('ch-price').value = c?.price_jpy ?? '';
  $('ch-payurl').value = c?.payment_url || '';
  $('ch-payinfo').value = c?.payment_info || '';
  $('ch-status').value = c?.status || 'draft';
  $('ch-tags').value = (c?.tags || []).join('、');
  m.style.display = 'flex';
  m.onclick = () => { m.style.display = 'none'; };            // 外側を押すと閉じる
  $('ch-cancel').onclick = () => { m.style.display = 'none'; };
  $('ch-save').onclick = async () => {
    const name = $('ch-name').value.trim();
    if (!name) return toast('名前は必須です');
    const row = { room_id: room.id, name, period_label: $('ch-period').value.trim() || null, starts_on: $('ch-starts').value || null,
      total_sessions: Number($('ch-total').value) || 21, intake_from: $('ch-from').value || null, intake_to: $('ch-to').value || null,
      price_jpy: $('ch-price').value === '' ? null : Number($('ch-price').value), payment_url: $('ch-payurl').value.trim() || null,
      payment_info: $('ch-payinfo').value.trim() || null, status: $('ch-status').value,
      tags: $('ch-tags').value.split(/[、,\s]+/).map(t => t.trim()).filter(Boolean) };
    const { error } = c ? await supa.from('cohorts').update(row).eq('id', c.id) : await supa.from('cohorts').insert(row);
    if (error) return toast('保存に失敗しました：' + error.message);
    m.style.display = 'none';
    const { data } = await supa.from('cohorts').select('*').order('sort_order').order('starts_on', { ascending:false });
    L.cohorts = data || L.cohorts;
    toast('保存しました'); renderNav();
    const fresh = c ? (L.cohorts.find(x => x.id === c.id) || c) : null;
    if (S.current?.type === 'cohort' && fresh) openCohortDays(fresh);
    else if (S.current?.type === 'room') renderSeries();
    else openLessonsRoom(room);
  };
}

/* ============================================================
   参加者の管理（editor 以上）：手動追加・支払い確認
   ============================================================ */
async function renderCohortMembersAdmin(){
  const room = S.current.room;
  const rc = L.cohorts.filter(c => c.room_id === room.id);
  if (!rc.length) { $('page').innerHTML = `<div class="card"><div class="empty">まだ期がありません。「シリーズ」タブの「期を作る」から。</div></div>`; return; }
  const cid = S.cmCohort && rc.some(c => c.id === S.cmCohort) ? S.cmCohort : (rc.find(c => c.status === 'open' || c.status === 'active') || rc[0]).id;
  S.cmCohort = cid;
  const c = rc.find(x => x.id === cid);
  const { data: ms, error } = await supa.from('cohort_members').select('*').eq('cohort_id', cid).order('joined_at');
  if (error) { $('page').innerHTML = errBox(error); return; }
  const members = ms || [];
  const { data: profs } = members.length ? await supa.from('profiles').select('id, email, display_name').in('id', members.map(m => m.user_id)) : { data: [] };
  const pmap = {}; (profs || []).forEach(p => pmap[p.id] = p);
  $('page').innerHTML = `
    <div class="card"><h3><span class="bar"></span>期を選ぶ</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="form-input" style="width:auto" id="cm-sel">${rc.map(x => `<option value="${x.id}" ${x.id === cid ? 'selected' : ''}>${esc(x.name)}${x.period_label ? '（' + esc(x.period_label) + '）' : ''} ・ ${x.status}</option>`).join('')}</select>
        <button class="add-res-btn" style="margin:0" id="cm-edit">✏️ この期を編集</button>
      </div>
    </div>
    <div class="card"><h3><span class="bar"></span>参加者を追加</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="form-input" id="cm-email" placeholder="メールアドレス（ログインに使うもの）" style="flex:1;min-width:220px">
        <label style="font-size:12.5px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="cm-paid" checked>支払い確認済み</label>
        <button class="primary-btn" id="cm-add">追加</button>
      </div>
      <p class="muted" style="margin-top:8px">一度ログインしたことのある人だけ追加できます。追加すると 21 Lessons の部屋にも入ります。</p>
    </div>
    <div class="card"><h3><span class="bar"></span>${esc(c.name)} の参加者（${members.length}人）<span class="muted" style="margin-left:auto;font-weight:400">支払い確認済み ${members.filter(m => m.paid_at).length}</span></h3>
      ${members.map(m => { const p = pmap[m.user_id] || {}; return `
        <div class="res-item">
          <div class="avatar">${esc(initialOf(p.display_name))}</div>
          <div style="min-width:0"><div class="res-name">${esc(p.display_name || '')}</div><div class="res-sub">${esc(p.email || '')} ・ ${fmtDay(m.joined_at)} 参加</div></div>
          <div style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-shrink:0">
            <button class="add-res-btn ${m.paid_at ? 'sg-btn on' : ''}" style="margin:0;padding:5px 12px;font-size:12px" data-paid="${m.id}" data-on="${m.paid_at ? '1' : ''}">${m.paid_at ? '✓ 支払い確認済み' : '未確認 → 確認する'}</button>
            <button class="res-del" data-cmdel="${m.id}" title="この期から外す">✕</button>
          </div>
        </div>`; }).join('') || `<p class="muted">まだ参加者はいません</p>`}
    </div>`;
  $('cm-sel').onchange = () => { S.cmCohort = $('cm-sel').value; renderCohortMembersAdmin(); };
  $('cm-edit').onclick = () => openCohortModal(c, room);
  $('cm-add').onclick = async () => {
    const email = $('cm-email').value.trim().toLowerCase();
    if (!email.includes('@')) return toast('メールアドレスを入力してください');
    const { data: found } = await supa.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (!found) return toast('この人はまだログインしたことがありません。先に一度ログインしてもらってください');
    const { error } = await supa.from('cohort_members').upsert({ cohort_id: cid, user_id: found.id, paid_at: $('cm-paid').checked ? new Date().toISOString() : null }, { onConflict: 'cohort_id,user_id' });
    if (error) return toast('追加に失敗しました：' + error.message);
    toast('追加しました'); renderCohortMembersAdmin();
  };
  $('page').querySelectorAll('[data-paid]').forEach(el => el.onclick = async () => {
    const on = !!el.dataset.on;
    if (on && !confirm('支払い確認を取り消しますか？（この人はレッスンが読めなくなります）')) return;
    const { error } = await supa.from('cohort_members').update({ paid_at: on ? null : new Date().toISOString() }).eq('id', el.dataset.paid);
    if (error) return toast('更新に失敗しました：' + error.message);
    renderCohortMembersAdmin();
  });
  $('page').querySelectorAll('[data-cmdel]').forEach(el => el.onclick = async () => {
    if (!confirm('この期から外しますか？')) return;
    const { error } = await supa.from('cohort_members').delete().eq('id', el.dataset.cmdel);
    if (error) return toast('削除に失敗しました：' + error.message);
    renderCohortMembersAdmin();
  });
}
