/* Creating Room — chat.js
   1) チャットの共通部品（吹き出し・送信欄）。21 Lessons の期のチャット（lessons.js）と部屋のチャットの両方がこれを使う。
   2) 部屋のチャット（FST・MMOT・Sales …）。投稿は posts テーブル、既読は last_seen テーブル。
   index.html より前に読み込まれるが、中の関数は画面が動き始めてから呼ばれるので、順番は問題ない。 */

/* ============================================================
   共通部品
   ============================================================ */

/* 吹き出し 1 つ分の HTML。
   x : { id, user_id, body, created_at, parent_id }
   o : { mine, isStaff, staffLabel, parent, canDelete, cls }
       mine      … 自分の投稿（右寄せ）
       isStaff   … 事務局側の人（アバターを赤に、名前の横にラベル）
       parent    … 返信先の投稿（あれば引用を出す）
       canDelete … 削除ボタンを出すか
       cls       … 追加のクラス（部屋チャットの返信は 'msg-reply' で字下げ） */
function msgBubbleHtml(x, o = {}){
  const name = S.profilesCache[x.user_id] || '…';
  return `<div class="msg ${o.mine ? 'mine' : ''} ${o.cls || ''}" id="c-${x.id}">
    <div class="avatar cav ${o.isStaff ? 'cav-ed' : ''}">${esc(initialOf(name))}</div>
    <div class="msg-body">
      <div class="msg-head"><b>${esc(name)}</b>${o.isStaff ? `<span class="cwho-ed" style="margin-left:6px">${esc(o.staffLabel || '担当')}</span>` : ''}<span>${fmtWhen(x.created_at)}</span></div>
      ${o.parent ? `<div class="msg-quote">↩ ${esc(S.profilesCache[o.parent.user_id] || '')}：${esc(plainText(o.parent.body).slice(0, 50))}</div>` : ''}
      <div class="msg-text">${esc(x.body)}</div>
      <div class="msg-tools"><button data-reply="${x.parent_id || x.id}" data-reply-name="${esc(name)}">↩ 返信</button>${o.canDelete ? `<button data-del="${x.id}">削除</button>` : ''}</div>
    </div></div>`;
}

/* 送信欄をつなぐ：返信チップ（#reply-chip）・入力欄（#chat-in）・送信ボタン（#chat-send）・Enter で送信。
   画面側は先に HTML を置いてから呼ぶ。
   o.onSend(body, replyTo)  … 送信。false を返すと入力欄を消さない（失敗したとき）
   o.onDelete(id)           … 削除ボタン（省略可）
   戻り値 { setReply(id, name) } */
function setupComposer(o){
  const chip = $('reply-chip'), ta = $('chat-in');
  let replyTo = null;
  const setReply = (id, name) => {
    replyTo = id || null;
    if (!id) { chip.style.display = 'none'; chip.innerHTML = ''; return; }
    chip.style.display = 'flex'; chip.innerHTML = `<span>↩ ${esc(name)}さんに返信</span><button id="reply-x">×</button>`;
    $('reply-x').onclick = () => setReply(null);
    ta.focus();
  };
  $('page').querySelectorAll('[data-reply]').forEach(el => el.onclick = () => setReply(el.dataset.reply, el.dataset.replyName));
  if (o.onDelete) $('page').querySelectorAll('[data-del]').forEach(el => el.onclick = () => o.onDelete(el.dataset.del));
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; };
  ta.oninput = grow;
  const send = async () => {
    const body = ta.value.trim(); if (!body) return;
    const wasReply = replyTo;
    ta.value = ''; setReply(null);
    const ok = await o.onSend(body, wasReply);
    if (ok === false) { ta.value = body; if (wasReply) replyTo = wasReply; }
  };
  $('chat-send').onclick = send;
  ta.onkeydown = e => enterToSend(e, send);
  return { setReply };
}

/* 掲示板型の並べ方：親の投稿の直下に返信をぶら下げる（返信への返信も同じ段に並ぶ）。
   list … {id, parent_id, created_at} の配列（時系列順）
   戻り値 … [{x, cls}] の配列。返信は cls='msg-reply'（字下げ） */
function threaded(list){
  const ids = new Set(list.map(x => x.id));
  const tops = list.filter(x => !x.parent_id || !ids.has(x.parent_id));
  const kids = {};
  list.filter(x => x.parent_id && ids.has(x.parent_id)).forEach(x => (kids[x.parent_id] = kids[x.parent_id] || []).push(x));
  return tops.flatMap(t => [{ x: t, cls: '' }, ...(kids[t.id] || []).map(k => ({ x: k, cls: 'msg-reply' }))]);
}

/* ============================================================
   既読（last_seen）と未読の⭕️
   ============================================================ */
/* S.chatUnread：room_id -> 未読の数（サイドバーの⭕️）。refreshChatUnread が入れる */

async function lastSeenAt(scope){
  const { data } = await supa.from('last_seen').select('seen_at').eq('user_id', S.user.id).eq('scope', scope).maybeSingle();
  return data?.seen_at || '1970-01-01T00:00:00Z';
}
async function markSeen(scope){
  const { error } = await supa.from('last_seen').upsert({ user_id: S.user.id, scope, seen_at: new Date().toISOString() });
  if (error) console.warn('last_seen', error.message);
}
/* 部屋ごとの未読数を取り直してサイドバーを描き直す */
async function refreshChatUnread(){
  const { data, error } = await supa.rpc('unread_chat_counts');
  if (error) { console.warn('unread_chat_counts', error.message); return; }
  S.chatUnread = {};
  (data || []).forEach(r => { S.chatUnread[r.room_id] = Number(r.n) || 0; });
  renderNav(); highlightNav();
}

/* ============================================================
   部屋のチャット
   ============================================================ */
async function renderRoomChat(opts = {}){
  leaveChat();
  const room = S.current.room, roomId = room.id;
  const keep = opts.keepScroll ? $('chat-scroll')?.scrollTop : null;
  if (!opts.keepScroll) $('page').innerHTML = `<div class="empty">読み込み中…</div>`;

  const [{ data, error }, seen, staff] = await Promise.all([
    supa.from('posts').select('*').eq('room_id', roomId).eq('kind', 'chat').is('deleted_at', null).order('created_at'),
    lastSeenAt('room_chat:' + roomId),
    editorIdsFor(roomId),   // その部屋の editor / admin（事務局側の人にはラベルを付ける）
  ]);
  if (error) { $('page').innerHTML = errBox(error); return; }
  if (S.current?.room?.id !== roomId || S.tab !== 'roomchat') return;   // 読んでいる間に別の画面へ移った

  const posts = data || [];
  await ensureNames(posts.map(p => p.user_id));
  const byId = {}; posts.forEach(p => byId[p.id] = p);
  const moderator = can(roomId, 'moderate_chat');

  let firstNew = false;
  const bubble = (p, cls) => {
    const isNew = p.created_at > seen && p.user_id !== S.user.id;
    const mark = (isNew && !firstNew) ? (firstNew = true, `<div class="day-divider" id="first-new"><span style="color:var(--ai)">ここから新しい</span></div>`) : '';
    return mark + msgBubbleHtml(p, {
      mine: p.user_id === S.user.id,
      isStaff: staff.includes(p.user_id), staffLabel: 'RFC',
      canDelete: p.user_id === S.user.id || moderator,
      cls,
    });
  };
  const html = threaded(posts).map(({ x, cls }) => bubble(x, cls)).join('');   // 掲示板型（共通の threaded）

  const intro = room.pinned?.chat_intro;   // 「基本情報を編集」で設定する、先頭に固定の一言
  $('page').innerHTML = `<div class="chat-wrap" id="chat-wrap">
      <div class="chat-scroll" id="chat-scroll">
        ${intro ? `<div class="chat-rule">${richText(intro)}</div>` : ''}
        ${posts.length ? html : `<div class="day-divider"><span>まだ投稿はありません。最初のひとことをどうぞ。</span></div>`}
      </div>
      <div id="chat-people" class="muted" style="font-size:12px;padding:6px 14px 0;cursor:pointer">メンバーを見る ›</div>
      <div class="reply-chip" id="reply-chip" style="display:none"></div>
      <div class="chat-input"><textarea id="chat-in" rows="1" placeholder="ひとこと・質問・返信を書く…"></textarea><button class="send" id="chat-send">↑</button></div>
    </div>`;

  setupComposer({
    onSend: async (body, replyTo) => {
      const { error } = await supa.from('posts').insert({ room_id: roomId, user_id: S.user.id, parent_id: replyTo || null, body });
      if (error) { toast('送信に失敗しました：' + error.message); return false; }
      renderRoomChat({ keepScroll: true, scrollBottom: !replyTo });
    },
    onDelete: async id => {
      if (!confirm('この投稿を削除しますか？')) return;
      const { error } = await supa.from('posts').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) return toast('削除に失敗しました：' + error.message);
      renderRoomChat({ keepScroll: true });
    },
  });

  // 入力欄の上の「メンバー n人 ›」：押すと基本情報タブのメンバー一覧へ
  const cp = $('chat-people');
  cp.onclick = () => { S.scrollPeople = true; showTab('pinned'); };
  roomPeople(roomId).then(p => { const el = $('chat-people'); if (el) el.textContent = `メンバー ${p.members.length}人 ›`; });

  // スクロール位置：未読があればそこへ、なければ一番下（描き直しのときは元の位置）
  const sc = $('chat-scroll');
  if (opts.scrollBottom) sc.scrollTop = sc.scrollHeight;
  else if (keep != null) sc.scrollTop = keep;
  else if ($('first-new')) $('first-new').scrollIntoView({ block: 'start' });
  else sc.scrollTop = sc.scrollHeight;
  document.querySelector('.content').scrollTop = 0;

  // 見た、にする（自分の⭕️を消す）
  markSeen('room_chat:' + roomId).then(refreshChatUnread);

  // 開いている間に他の人が書いたら描き直す
  S.chatChannel = supa.channel('room-chat-' + roomId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: 'room_id=eq.' + roomId }, payload => {
      if (S.current?.room?.id !== roomId || S.tab !== 'roomchat') return;
      if (payload.new?.user_id === S.user.id) return;
      renderRoomChat({ keepScroll: true });
    }).subscribe();
}

/* ============================================================
   部屋のメンバー一覧（21 Lessons の「参加者」と同じ見せ方）
   名前だけを返す Supabase 関数 room_participants を使う（room-people.sql）
   ============================================================ */
const _roomPeopleCache = {};
async function roomPeople(roomId, force){
  if (!force && _roomPeopleCache[roomId]) return _roomPeopleCache[roomId];
  const { data, error } = await supa.rpc('room_participants', { p_room: roomId });
  if (error) { console.warn('room_participants', error.message); return { members: [], staff: [] }; }
  const all = data || [];
  const isStaff = x => PERMS.moderate_chat.includes(x.role);   // editor / admin ＝ 運営
  const p = { staff: all.filter(isStaff), members: all.filter(x => !isStaff(x)) };
  _roomPeopleCache[roomId] = p;
  return p;
}
/* 基本情報タブの末尾に置くカード。fillRoomPeople で中身を入れる */
const roomPeopleCardHtml = () =>
  `<div class="card" id="rp-card"><h3><span class="bar"></span>メンバー<span class="muted" id="rp-n" style="margin-left:auto;font-weight:400"></span></h3><div id="rp-list" class="muted">読み込み中…</div></div>`;
async function fillRoomPeople(roomId, scrollTo){
  const p = await roomPeople(roomId, true);
  const n = $('rp-n'), l = $('rp-list'); if (!n || !l) return;
  n.textContent = `${p.members.length}人`;
  l.className = ''; l.innerHTML = peopleHTML(p);   // peopleHTML は lessons.js（参加者＋運営の並べ方を共通にする）
  if (scrollTo) $('rp-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
