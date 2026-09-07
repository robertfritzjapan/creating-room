/* Creating Room — feed.js
   新着フィードの「お知らせ」（posts の kind='announcement'）と、未読の知らせ（メニューの⭕️・上部バナー）。
   room_id が入っているお知らせ＝その部屋のメンバーだけに見える。
   room_id が空のお知らせ＝ログインしている全員に見える「メンバー限定」（早耳ニュース）。
   既読は last_seen の scope 'feed'（chat.js の markSeen / lastSeenAt を使う）。 */

const ANN_ALL_LABEL = 'メンバー限定';

/* お知らせを書ける部屋（editor / admin の部屋）。全員向けは admin の人だけ */
const announceRooms = () => S.rooms.filter(r => can(r.id, 'post_announcement') && !isNoteRoom(r));
const canAnnounceAll = () => S.memberships.some(m => PERMS.announce_all.includes(m.role));
const canAnnounce = () => canAnnounceAll() || announceRooms().length > 0;

/* ---------- 読む ---------- */
async function fetchAnnouncements(limit = 20){
  const { data, error } = await supa.from('posts').select('*')
    .eq('kind', 'announcement').is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) { console.warn('announcements', error.message); return []; }
  await ensureNames((data || []).map(p => p.user_id));
  return data || [];
}

/* フィードの 1 件分。openHome が items に混ぜて使う */
function announcementHtml(p){
  const room = p.room_id ? S.rooms.find(r => r.id === p.room_id) : null;
  const chip = room ? esc(t(room.name)) : ANN_ALL_LABEL;
  const canDel = p.user_id === S.user.id || (room && can(room.id, 'post_announcement'));
  return `<div class="feed-item feed-ann" id="ann-${p.id}">
    <div class="avatar" style="background:var(--ai)">📣</div>
    <div class="feed-body">
      <div class="feed-meta">${esc(S.profilesCache[p.user_id] || '')}<span class="room-chip">${chip}</span> ・ ${fmtDay(p.created_at)}
        ${canDel ? `<button class="res-del" data-ann-del="${p.id}" title="削除" style="margin-left:6px">✕</button>` : ''}</div>
      ${p.title ? `<div class="feed-title">${esc(p.title)}</div>` : ''}
      <div class="feed-text">${richText(p.body)}</div>
    </div>
  </div>`;
}

/* フィードの中のボタン（削除）をつなぐ。openHome が描いた後に呼ぶ */
function bindAnnouncementActions(){
  $('page').querySelectorAll('[data-ann-del]').forEach(el => el.onclick = async () => {
    if (!confirm('このお知らせを削除しますか？')) return;
    const { error } = await supa.from('posts').update({ deleted_at: new Date().toISOString() }).eq('id', el.dataset.annDel);
    if (error) return toast('削除に失敗しました：' + error.message);
    toast('削除しました');
    openHome();
  });
  const b = $('ann-new'); if (b) b.onclick = () => openAnnounceModal();
}

/* ---------- 書く（モーダル）---------- */
function openAnnounceModal(){
  const sel = $('ann-room');
  sel.innerHTML = [
    ...(canAnnounceAll() ? [`<option value="">${ANN_ALL_LABEL}（ログインしている全員）</option>`] : []),
    ...announceRooms().map(r => `<option value="${r.id}">${esc(t(r.name))} のメンバー</option>`),
  ].join('');
  $('ann-title').value = ''; $('ann-body').value = '';
  $('ann-modal').style.display = 'flex';
  setTimeout(() => $('ann-title').focus(), 50);
}
/* （このファイルは index.html の本体より先に読まれるので、ここだけは document.getElementById を直接使う） */
document.getElementById('ann-modal').onclick = () => { document.getElementById('ann-modal').style.display = 'none'; };
document.getElementById('ann-save').onclick = async () => {
  const title = $('ann-title').value.trim(), body = $('ann-body').value.trim();
  if (!body) return toast('本文を書いてください');
  const roomId = $('ann-room').value || null;
  $('ann-save').disabled = true;
  const { error } = await supa.from('posts').insert({ room_id: roomId, user_id: S.user.id, kind: 'announcement', title: title || null, body });
  $('ann-save').disabled = false;
  if (error) return toast('投稿に失敗しました：' + error.message);
  $('ann-modal').style.display = 'none';
  toast('お知らせを出しました');
  if (S.current?.type === 'home') openHome();
};

/* ---------- 未読（メニューの⭕️と上部バナー）---------- */
/* S.feedUnread：自分が最後にホームを見た後に、他の人が出したお知らせの数 */
async function refreshFeedUnread(){
  const seen = await lastSeenAt('feed');
  const { count, error } = await supa.from('posts').select('id', { count: 'exact', head: true })
    .eq('kind', 'announcement').is('deleted_at', null).neq('user_id', S.user.id).gt('created_at', seen);
  if (error) { console.warn('feed unread', error.message); return; }
  S.feedUnread = count || 0;
  renderNav(); highlightNav();
}
/* ホーム以外の画面にいるとき、未読のお知らせがあれば上に一行出す */
function updateFeedBanner(){
  const b = $('feed-banner'); if (!b) return;
  const show = (S.feedUnread || 0) > 0 && S.current?.type !== 'home';
  b.hidden = !show;
  if (show) b.textContent = `新しいお知らせが ${S.feedUnread} 件あります →`;
}
/* ホームを開いた＝見た。openHome から呼ぶ */
function markFeedSeen(){
  S.feedUnread = 0;
  updateFeedBanner();
  markSeen('feed').then(() => { renderNav(); highlightNav(); });
}
