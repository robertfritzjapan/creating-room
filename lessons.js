diff --git a/index.html b/index.html
index a07b1c3..04b3365 100644
--- a/index.html
+++ b/index.html
@@ -957,7 +957,7 @@ details.sec-more .sec-body{font-size:15.5px;line-height:1.95;margin-top:8px;
 <script src="vendor/supabase.js"></script>
 <script src="chat.js?v=3"></script>
 <script src="feed.js?v=1"></script>
-<script src="lessons.js?v=8"></script>
+<script src="lessons.js?v=9"></script>
 <script>
 /* ================= 設定 ================= */
 if (!window.supabase) { document.getElementById('boot').textContent = '読み込みに失敗しました。再読み込みしてください。'; throw new Error('supabase-js not loaded'); }
diff --git a/lessons.js b/lessons.js
index 8b1af51..57536cf 100644
--- a/lessons.js
+++ b/lessons.js
@@ -239,7 +239,7 @@ async function openCohortAbout(c, opts = {}){
           ${c.payment_info ? `<div class="kv stack"><b>お支払い</b><span>${richText(c.payment_info)}</span></div>` : ''}
           <button class="primary-btn" style="margin-top:10px" id="ca-join">${c.payment_url ? '申し込む' : '参加する'}</button>
         </div>`}
-    ${unpaid && (c.payment_info || c.payment_url) ? `<div class="card" style="background:#faf9f8">
+    ${unpaid && (c.payment_info || c.payment_url) ? `<div class="card" id="ca-pay" style="background:#faf9f8">
       <h3><span class="bar"></span>お支払いのご案内<span class="muted" style="margin-left:auto;font-weight:400">お支払いの確認待ち</span></h3>
       ${c.payment_info ? `<div class="kv stack"><b>お支払い</b><span>${richText(c.payment_info)}</span></div>` : ''}
       ${c.payment_url ? `<a class="zoom-btn" href="${esc(c.payment_url)}" target="_blank" rel="noopener">${payLabel(c.payment_url)}</a>` : ''}
@@ -253,6 +253,7 @@ async function openCohortAbout(c, opts = {}){
       if (opts.scrollPeople) $('ca-people').scrollIntoView({ behavior:'smooth', block:'start' });
     });
   }
+  if (opts.scrollPay) { const pay = $('ca-pay'); if (pay) pay.scrollIntoView({ behavior:'smooth', block:'start' }); }
   const ch = $('ca-chat'); if (ch) ch.onclick = () => openCohortChat(c);
   const dy = $('ca-days'); if (dy) dy.onclick = () => openCohortDays(c);
   const ed = $('ca-edit'); if (ed) ed.onclick = () => openCohortModal(c, room);
@@ -270,9 +271,15 @@ async function joinCohort(cohortId, room){
   S.memberships = ms || S.memberships; L.myCM = cm || L.myCM;
   L.editorRooms = S.memberships.filter(x => PERMS.edit_lessons.includes(x.role)).map(x => x.room_id);
   renderNav(); renderMe();
-  if (c?.payment_url) { window.open(c.payment_url, '_blank', 'noopener'); toast('参加を受け付けました。お支払いページを開きました'); }
-  else toast('参加を受け付けました。レッスンはもう読めます');
-  openRoom(room);
+  /* 申し込み後は支払いページを自動で開かず、その期の説明ページに留まる。
+     「お支払いのご案内」カード（振込先＋PayPal ボタン）が出るので、本人が方法を選ぶ。 */
+  if (c && (c.payment_info || c.payment_url)) {
+    toast('参加を受け付けました。お支払い方法は下の案内をご覧ください');
+    await openCohortAbout(c, { scrollPay: true });
+  } else {
+    toast('参加を受け付けました。レッスンはもう読めます');
+    if (c) await openCohortAbout(c); else openRoom(room);
+  }
 }
 
 /* ============================================================
