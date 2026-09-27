(function(){
  const $ = id => document.getElementById(id);
  const API = ''; // same origin
  let token = localStorage.getItem('ledgerToken') || null;
  let userEmail = localStorage.getItem('ledgerEmail') || '';
  let allTxns = [];       // in-memory + cached list, newest first
  let pendingQueue = [];  // actions waiting to sync: {type:'create'|'delete', localId?, id?, payload?}
  let state = { type:null, pay:null, photoPreview:null };

  const todayStr = () => new Date().toISOString().slice(0,10);
  function fmt(n){ return 'RM ' + (n||0).toFixed(2); }
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function loadCache(){
    try{ allTxns = JSON.parse(localStorage.getItem('ledgerCache')||'[]'); }catch(e){ allTxns=[]; }
    try{ pendingQueue = JSON.parse(localStorage.getItem('ledgerQueue')||'[]'); }catch(e){ pendingQueue=[]; }
  }
  function saveCache(){ localStorage.setItem('ledgerCache', JSON.stringify(allTxns)); }
  function saveQueue(){ localStorage.setItem('ledgerQueue', JSON.stringify(pendingQueue)); }

  function authHeaders(){ return { 'Content-Type':'application/json', 'Authorization':'Bearer '+token }; }

  // ---------- Service worker (app shell offline caching) ----------
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }

  // ---------- Auth ----------
  let authMode = 'login';
  $('tabLoginBtn').onclick = () => { authMode='login'; $('tabLoginBtn').classList.add('active'); $('tabSignupBtn').classList.remove('active'); $('authSubmit').textContent='Log in'; };
  $('tabSignupBtn').onclick = () => { authMode='signup'; $('tabSignupBtn').classList.add('active'); $('tabLoginBtn').classList.remove('active'); $('authSubmit').textContent='Create account'; };

  $('authSubmit').onclick = async () => {
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    $('authError').textContent = '';
    if(!email || !password){ $('authError').textContent = 'Enter an email and password.'; return; }
    try{
      const res = await fetch(API + '/api/' + authMode, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if(!res.ok){ $('authError').textContent = data.error || 'Something went wrong.'; return; }
      token = data.token; userEmail = data.email;
      localStorage.setItem('ledgerToken', token);
      localStorage.setItem('ledgerEmail', userEmail);
      enterApp();
    }catch(e){
      $('authError').textContent = 'No internet connection — you need to be online for your first login.';
    }
  };
  $('logoutBtn').onclick = () => {
    localStorage.removeItem('ledgerToken');
    token = null;
    $('app').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
  };

  function enterApp(){
    $('authScreen').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('userEmail').textContent = userEmail;
    loadCache();
    renderAll();
    refreshFromServer();
    if(navigator.onLine) flushQueue();
  }

  function setBanner(){
    const b = $('banner');
    if(navigator.onLine){ b.textContent='🟢 Online — synced'; b.className='banner online'; }
    else { b.textContent='📴 Offline — saving on this device, will sync when back online'; b.className='banner offline'; }
  }
  window.addEventListener('online', () => { setBanner(); flushQueue(); refreshFromServer(); });
  window.addEventListener('offline', setBanner);
  setBanner();

  // ---------- Server sync ----------
  async function refreshFromServer(){
    if(!token || !navigator.onLine) return;
    try{
      const res = await fetch(API + '/api/transactions', { headers: authHeaders() });
      if(res.status === 401){ $('logoutBtn').click(); return; }
      if(!res.ok) return;
      const rows = await res.json();
      allTxns = rows.map(r => ({ ...r, id: String(r.id), pending:false }));
      // keep any still-queued local-only creates on top so they aren't lost visually
      pendingQueue.filter(a=>a.type==='create').forEach(a=>{
        if(!allTxns.some(t=>t.id===a.localId)) allTxns.unshift({ ...a.payload, id:a.localId, pending:true });
      });
      saveCache();
      renderAll();
    }catch(e){ /* stay on cached data */ }
  }

  async function flushQueue(){
    while(pendingQueue.length && navigator.onLine){
      const action = pendingQueue[0];
      try{
        if(action.type === 'create'){
          const res = await fetch(API + '/api/transactions', { method:'POST', headers: authHeaders(), body: JSON.stringify(action.payload) });
          if(!res.ok) break;
          const saved = await res.json();
          allTxns = allTxns.map(t => t.id === action.localId ? { ...saved, id:String(saved.id), pending:false } : t);
        } else if(action.type === 'delete'){
          await fetch(API + '/api/transactions/' + action.id, { method:'DELETE', headers: authHeaders() });
        }
        pendingQueue.shift();
        saveQueue(); saveCache(); renderAll();
      }catch(e){ break; } // still offline or server unreachable - stop, try again later
    }
  }

  // ---------- Tabs ----------
  $('tabLog').onclick = () => switchTab('log');
  $('tabDay').onclick = () => switchTab('day');
  $('tabMonth').onclick = () => switchTab('month');
  function switchTab(t){
    $('tabLog').classList.toggle('active', t==='log');
    $('tabDay').classList.toggle('active', t==='day');
    $('tabMonth').classList.toggle('active', t==='month');
    $('viewLog').classList.toggle('hidden', t!=='log');
    $('viewDay').classList.toggle('hidden', t!=='day');
    $('viewMonth').classList.toggle('hidden', t!=='month');
    if(t==='day') renderDay();
    if(t==='month') renderMonth();
  }

  document.querySelectorAll('[data-type]').forEach(btn=>{
    btn.onclick = () => {
      state.type = btn.dataset.type;
      document.querySelectorAll('[data-type]').forEach(b=>b.classList.remove('chosen'));
      btn.classList.add('chosen');
      $('payWrap').classList.toggle('hidden', state.type==='trade');
      $('amountWrap').classList.toggle('hidden', state.type==='trade');
    };
  });
  document.querySelectorAll('[data-pay]').forEach(btn=>{
    btn.onclick = () => {
      state.pay = btn.dataset.pay;
      document.querySelectorAll('[data-pay]').forEach(b=>b.classList.remove('chosen'));
      btn.classList.add('chosen');
    };
  });

  $('photoInput').addEventListener('change', function(){
    const file = this.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const maxW = 700;
        const scale = Math.min(1, maxW/img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width*scale; canvas.height = img.height*scale;
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        state.photoPreview = canvas.toDataURL('image/jpeg', 0.5);
        $('photoPreview').src = state.photoPreview;
        $('photoPreview').classList.remove('hidden');
        $('photoClear').classList.remove('hidden');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  $('photoClear').onclick = () => {
    state.photoPreview=null;
    $('photoInput').value=''; $('photoPreview').classList.add('hidden'); $('photoClear').classList.add('hidden');
  };

  // ---------- Save (works offline) ----------
  $('saveBtn').onclick = async () => {
    if(!state.type){ alert('Pick Sell, Buy or Trade first.'); return; }
    if(state.type!=='trade'){
      if(!state.pay){ alert('Pick a payment method.'); return; }
      const amt = parseFloat($('amountInput').value);
      if(!amt || amt<=0){ alert('Enter an amount.'); return; }
    }
    const now = new Date();
    const payload = {
      date: todayStr(),
      time: now.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}),
      type: state.type,
      pay: state.type==='trade' ? null : state.pay,
      amount: state.type==='trade' ? 0 : parseFloat($('amountInput').value),
      note: $('noteInput').value.trim(),
      photo: state.photoPreview || null,
      created_at: now.getTime()
    };
    const localId = 'local-' + now.getTime();
    allTxns.unshift({ ...payload, id: localId, pending: true });
    saveCache(); renderAll();

    if(navigator.onLine){
      try{
        const res = await fetch(API + '/api/transactions', { method:'POST', headers: authHeaders(), body: JSON.stringify(payload) });
        if(res.ok){
          const saved = await res.json();
          allTxns = allTxns.map(t => t.id===localId ? { ...saved, id:String(saved.id), pending:false } : t);
        } else {
          pendingQueue.push({ type:'create', localId, payload }); saveQueue();
        }
      }catch(e){
        pendingQueue.push({ type:'create', localId, payload }); saveQueue();
      }
    } else {
      pendingQueue.push({ type:'create', localId, payload }); saveQueue();
    }
    saveCache(); renderAll();

    state = { type:null, pay:null, photoPreview:null };
    document.querySelectorAll('[data-type],[data-pay]').forEach(b=>b.classList.remove('chosen'));
    $('amountInput').value=''; $('noteInput').value='';
    $('photoInput').value=''; $('photoPreview').classList.add('hidden'); $('photoClear').classList.add('hidden');
    $('payWrap').classList.remove('hidden'); $('amountWrap').classList.remove('hidden');
    switchTab('day');
  };

  // ---------- Day view ----------
  function renderAll(){
    if(!$('viewDay').classList.contains('hidden')) renderDay();
    if(!$('viewMonth').classList.contains('hidden')) renderMonth();
  }
  function renderDay(){
    const dates = [...new Set(allTxns.map(t=>t.date))].sort().reverse();
    if(!dates.includes(todayStr())) dates.unshift(todayStr());
    const sel = $('dateSelect'); const prevVal = sel.value;
    sel.innerHTML = dates.map(d=>`<option value="${d}">${d===todayStr()?'Today — ':''}${d}</option>`).join('');
    sel.value = dates.includes(prevVal) ? prevVal : todayStr();
    sel.onchange = drawDay;
    drawDay();
  }
  function drawDay(){
    const d = $('dateSelect').value;
    const dayTxns = allTxns.filter(t=>t.date===d).sort((a,b)=>(b.created_at||0)-(a.created_at||0));
    let cash=0,bank=0,tng=0,tradeCount=0;
    dayTxns.forEach(t=>{
      if(t.type==='trade'){ tradeCount++; return; }
      const sign = t.type==='sell' ? 1 : -1;
      const amt = parseFloat(t.amount)||0;
      if(t.pay==='cash') cash+=sign*amt;
      if(t.pay==='bank') bank+=sign*amt;
      if(t.pay==='tng') tng+=sign*amt;
    });
    $('totCash').textContent=fmt(cash); $('totBank').textContent=fmt(bank); $('totTng').textContent=fmt(tng);
    $('totTrade').textContent=tradeCount; $('totGrand').textContent=fmt(cash+bank+tng);
    $('emptyMsg').classList.toggle('hidden', dayTxns.length>0);
    $('txnList').innerHTML = dayTxns.map(t=>{
      const label = t.type==='trade' ? 'Trade' : `${fmt(parseFloat(t.amount)||0)} · ${(t.pay||'').toUpperCase()}`;
      const photoHtml = t.photo ? `<img class="thumb" src="${t.photo}" onclick="window.__openPhoto('${t.photo.replace(/'/g,"\\'")}')">` : '';
      const pendingHtml = t.pending ? '<div class="pending">⏳ waiting to sync</div>' : '';
      return `<div class="txn">
        <span class="badge ${t.type}">${t.type[0].toUpperCase()+t.type.slice(1)}</span>
        <div class="mid"><div class="amt">${label}</div><div class="note">${escapeHtml(t.note)} ${t.time}</div>${pendingHtml}</div>
        ${photoHtml}
        <button class="del" onclick="window.__delTxn('${t.id}')">✕</button>
      </div>`;
    }).join('');
  }

  // ---------- Month view ----------
  $('monthSelect').value = todayStr().slice(0,7);
  $('monthSelect').onchange = renderMonth;
  function renderMonth(){
    const ym = $('monthSelect').value || todayStr().slice(0,7);
    const dates = [...new Set(allTxns.filter(t=>t.date.startsWith(ym)).map(t=>t.date))].sort();
    let sell=0, buy=0, tradeCount=0;
    const rows = dates.map(d=>{
      const txns = allTxns.filter(t=>t.date===d);
      let dCash=0,dBank=0,dTng=0;
      txns.forEach(t=>{
        const amt = parseFloat(t.amount)||0;
        if(t.type==='trade'){ tradeCount++; return; }
        if(t.type==='sell') sell+=amt; else buy+=amt;
        const sign = t.type==='sell'?1:-1;
        if(t.pay==='cash') dCash+=sign*amt;
        if(t.pay==='bank') dBank+=sign*amt;
        if(t.pay==='tng') dTng+=sign*amt;
      });
      return {d, net: dCash+dBank+dTng, count: txns.length};
    }).reverse();
    $('mSell').textContent=fmt(sell); $('mBuy').textContent=fmt(buy);
    $('mTrade').textContent=tradeCount; $('mNet').textContent=fmt(sell-buy);
    $('mEmpty').classList.toggle('hidden', rows.length>0);
    $('dayRows').innerHTML = rows.map(r=>`<div class="dayrow" onclick="window.__goDay('${r.d}')">
      <span>${r.d} <span class="subtle" style="margin:0">(${r.count} txn)</span></span>
      <span style="font-weight:800">${fmt(r.net)}</span>
    </div>`).join('');
  }
  window.__goDay = (d) => { switchTab('day'); $('dateSelect').value = d; drawDay(); };
  window.__openPhoto = (src) => { $('photoModalImg').src = src; $('photoModal').classList.remove('hidden'); };
  $('photoModal').onclick = () => $('photoModal').classList.add('hidden');

  window.__delTxn = (id) => {
    if(!confirm('Delete this transaction?')) return;
    const isLocal = id.startsWith('local-');
    allTxns = allTxns.filter(t=>t.id!==id);
    if(isLocal){
      pendingQueue = pendingQueue.filter(a => a.localId !== id);
    } else {
      pendingQueue.push({ type:'delete', id });
    }
    saveCache(); saveQueue(); renderAll();
    if(navigator.onLine) flushQueue();
  };

  // ---------- Boot ----------
  loadCache();
  if(token){ enterApp(); } else { $('authScreen').classList.remove('hidden'); }
})();
