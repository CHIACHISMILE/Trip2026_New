const YOUR_GAS_URL = 'https://script.google.com/macros/s/AKfycbz6PZtqLJzlS2a71R-RfZjpJCuqJVPoP7RuNxEe74mS_uvxBejMNGKboFSn2ArNnXAu/exec';

// ... (Service Worker Code keeps same) ...
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}

async function callApi(action, data = null, method = 'GET') {
  const options = { method };
  if (method === 'POST') {
    options.body = JSON.stringify({ action, data });
    options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  }
  let url = YOUR_GAS_URL;
  if (method === 'GET') url += `?action=${action}`;

  try {
    const response = await fetch(url, options);
    const ct = response.headers.get("content-type");
    if (ct && ct.indexOf("application/json") === -1) throw new Error("Server Response Not JSON");
    if (!response.ok) throw new Error("Network error");
    return await response.json();
  } catch(e) {
    console.warn("API Fail:", e);
    return null; 
  }
}

const { createApp, ref, computed, onMounted, nextTick, watch, onBeforeUnmount } = Vue;

createApp({
  setup() {
    const tab = ref('itinerary');
    const isLoading = ref(true);
    const isFirstLoad = ref(true);
    const isPullRefreshing = ref(false);
    const isOnline = ref(navigator.onLine);
    const isSyncing = ref(false);
    const syncQueue = ref([]);
    const members = ref([]);
    const expenses = ref([]);
    const itinerary = ref([]);
    const rates = ref({});

    const dateContainer = ref(null);
    const scrollContainer = ref(null);
    const todayDate = ref('');
    const todayWeekday = ref('');

    // Image Viewer logic...
    const showImgViewer = ref(false);
    const viewingImg = ref('');
    const imgViewerEl = ref(null);
    const imgGesture = ref({ startX: 0, startY: 0, currentX: 0, currentY: 0, scale: 1, isPulling: false, isZooming: false, startDistance: 0 });

    const formatNote = (text) => {
        if (!text) return '';
        return text
            .replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">")
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="note-link" onclick="event.stopPropagation()">$1</a>')
            .replace(/(?<!href="|]\()((https?:\/\/[^\s<]+))/g, '<a href="$1" target="_blank" class="note-link" onclick="event.stopPropagation()">🔗</a>')
            .replace(/\n/g, '<br>');
    };

    // --- 莫蘭迪馬卡龍配色系統 (Morandi Macaron Palette) ---
    // 定義顏色代碼，用於圖表與背景
    const COLORS = {
        blue:   { border: 'border-[#9DB6CC]', bg: 'bg-[#E4EEF5]', text: 'text-[#5A748A]' }, // 冰河灰藍
        sand:   { border: 'border-[#DBCFB0]', bg: 'bg-[#F7F3E8]', text: 'text-[#8C7B50]' }, // 燕麥杏
        rose:   { border: 'border-[#D4A5A5]', bg: 'bg-[#F9EBEB]', text: 'text-[#9E6B6B]' }, // 馬卡龍粉
        violet: { border: 'border-[#B5A8BF]', bg: 'bg-[#F2EFF5]', text: 'text-[#7E7492]' }, // 薰衣草紫
        green:  { border: 'border-[#99A799]', bg: 'bg-[#EDF2EC]', text: 'text-[#5F7359]' }, // 鼠尾草綠
        gray:   { border: 'border-[#C4C4C4]', bg: 'bg-[#F3F4F6]', text: 'text-[#71717A]' }  // 迷霧灰
    };

    // 取得卡片「邊框顏色」Class (用於行程卡片的 border-left)
    const getCategoryBorderClass = (cat) => {
        switch(cat) {
            case '交通': return COLORS.blue.border;
            case '住宿': return COLORS.sand.border;
            case '景點': return COLORS.violet.border;
            case '飲食': return COLORS.rose.border;
            default: return COLORS.gray.border;
        }
    };

    // 取得記帳卡片「邊框顏色」Class
    const getExpenseBorderClass = (item) => {
        const s = String(item || '');
        if (s.includes('交通') || s.includes('機票') || s.includes('租車')) return COLORS.blue.border;
        if (s.includes('住宿')) return COLORS.sand.border;
        if (['早餐','午餐','晚餐','零食','飲料'].some(k => s.includes(k))) return COLORS.rose.border;
        if (['門票','景點','遊玩'].some(k => s.includes(k))) return COLORS.violet.border;
        if (s.includes('紀念品')) return COLORS.green.border;
        return COLORS.gray.border;
    };
    
    // 標籤顏色 (背景與文字)
    const getItemTagClass = (item) => {
        const s = String(item || '');
        let c = COLORS.gray;
        if (s.includes('交通') || s.includes('機票')) c = COLORS.blue;
        else if (s.includes('住宿')) c = COLORS.sand;
        else if (['早餐','午餐','晚餐','零食'].some(k => s.includes(k))) c = COLORS.rose;
        else if (s.includes('紀念品')) c = COLORS.green;
        return `${c.bg} ${c.text}`;
    };

    // --- Image Gesture logic (Same as before) ---
    const getDistance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const handleImgTouchStart = (e) => {
        if (e.touches.length === 2) { imgGesture.value.isZooming = true; imgGesture.value.startDistance = getDistance(e.touches); } 
        else if (e.touches.length === 1) { imgGesture.value.startX = e.touches[0].clientX; imgGesture.value.startY = e.touches[0].clientY; imgGesture.value.isPulling = false; }
    };
    const handleImgTouchMove = (e) => {
        if(!showImgViewer.value) return;
        e.preventDefault(); 
        if (e.touches.length === 2 && imgGesture.value.isZooming) {
            const dist = getDistance(e.touches);
            const newScale = Math.max(1, Math.min(imgGesture.value.scale * (dist / imgGesture.value.startDistance), 4));
            if (imgViewerEl.value) imgViewerEl.value.style.transform = `scale(${newScale})`;
            imgGesture.value.tempScale = newScale; 
        } else if (e.touches.length === 1) {
            const dy = e.touches[0].clientY - imgGesture.value.startY;
            if (imgGesture.value.scale === 1 && dy > 0) {
                imgGesture.value.isPulling = true; imgGesture.value.currentY = dy;
                if (imgViewerEl.value) imgViewerEl.value.style.transform = `translateY(${dy}px) scale(${1 - dy/1000})`;
                document.querySelector('.img-viewer-overlay').style.backgroundColor = `rgba(220, 226, 233, ${Math.max(0, 0.95 - dy/600)})`;
            } else if (imgGesture.value.scale > 1) {
                const dx = e.touches[0].clientX - imgGesture.value.startX;
                if (imgViewerEl.value) imgViewerEl.value.style.transform = `scale(${imgGesture.value.scale}) translate(${dx/imgGesture.value.scale}px, ${dy/imgGesture.value.scale}px)`;
            }
        }
    };
    const handleImgTouchEnd = (e) => {
        if (imgGesture.value.isZooming) {
            if (imgGesture.value.tempScale) imgGesture.value.scale = imgGesture.value.tempScale;
            imgGesture.value.isZooming = false; if (imgGesture.value.scale < 1) { imgGesture.value.scale = 1; resetImgTransform(); }
        } else if (imgGesture.value.isPulling) {
            if (imgGesture.value.currentY > 100) closeImgViewer(); else { resetImgTransform(); document.querySelector('.img-viewer-overlay').style.backgroundColor = ''; }
            imgGesture.value.isPulling = false;
        }
    };
    const resetImgTransform = () => { if (imgViewerEl.value) imgViewerEl.value.style.transform = `scale(${imgGesture.value.scale})`; };
    const toggleZoom = () => { imgGesture.value.scale = imgGesture.value.scale > 1 ? 1 : 2.5; resetImgTransform(); };

    // --- Basic Trip Logic ---
    const tripStatus = computed(() => {
      const now = new Date(); const start = new Date('2026-08-30'); const end = new Date('2026-09-26');
      now.setHours(0,0,0,0); start.setHours(0,0,0,0); end.setHours(0,0,0,0);
      if (now < start) return `倒數 ${Math.ceil((start - now)/86400000)} 天`;
      if (now >= start && now <= end) return `DAY ${Math.floor((now - start)/86400000) + 1}`;
      return '';
    });
    const tripDates = []; const startDate = new Date('2026-08-30');
    for (let d = new Date(startDate); d <= new Date('2026-09-26'); d.setDate(d.getDate()+1)) {
      tripDates.push({ date: d.toISOString().split('T')[0], short: (d.getMonth()+1)+'/'+d.getDate() });
    }
    const selDate = ref(tripDates[0].date);
    
    const showFilterMenu = ref(false);
    const filters = ref({ date: 'ALL', item: 'ALL', payer: 'ALL', location: 'ALL', payment: 'ALL' });
    const showRateModal = ref(false); const showItinModal = ref(false); const showExpModal = ref(false); const isEditing = ref(false);
    const itinForm = ref({ row: null, startTime: '09:00', endTime: '', category: '景點', title: '', location: '', link: '', note: '', imgUrl: '', newImageBase64: null, deleteImage: false, imgId: '' });
    const newExp = ref({ payer: '', location: '', item: '', payment: '', currency: 'NTD', amount: null, involved: [], note: '' });
    const editExpForm = ref({}); const tempRates = ref({});
    watch(() => newExp.value.payer, (v) => { if (v) newExp.value.involved = [v]; });
    const pullDistance = ref(0); const refreshText = computed(() => isPullRefreshing.value ? '同步中...' : '下拉同步');

    const initDate = () => {
      const now = new Date();
      todayDate.value = now.getFullYear() + '.' + String(now.getMonth()+1).padStart(2,'0') + '.' + String(now.getDate()).padStart(2,'0');
      const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      todayWeekday.value = days[now.getDay()];
    };

    // --- SCROLL & GESTURE (修復版) ---
    const gesture = { active:false, mode:null, startX:0, startY:0, dx:0, dy:0, startedAtLeftEdge:false, startedAtRightEdge:false, inSelectable:false, selectIntent:false, longPressTimer:null, allowPull: false };
    const hasTextSelection = () => { const sel = window.getSelection(); return !!(sel && sel.toString && sel.toString().length > 0); };
    const isBlockedTarget = (target) => {
      if (target.closest('.swipe-protected')) return true;
      const tag = (target.tagName || '').toLowerCase();
      if (['input','textarea','select','button','a','label'].includes(tag)) return true;
      return false;
    };
    const clearLongPress = () => { if (gesture.longPressTimer) { clearTimeout(gesture.longPressTimer); gesture.longPressTimer = null; } };
    
    const attachGestureListeners = () => {
      const el = scrollContainer.value; if (!el) return;
      
      const onTouchStart = (e) => {
        const t = e.touches[0]; 
        gesture.active = true; gesture.mode = null; gesture.dx = 0; gesture.dy = 0; gesture.startX = t.clientX; gesture.startY = t.clientY;
        const w = window.innerWidth; gesture.startedAtLeftEdge = (gesture.startX <= w * 0.15); gesture.startedAtRightEdge = (gesture.startX >= w * 0.85);
        
        // --- 修正下拉邏輯 ---
        // 1. 確保目前捲軸在最頂端 (scrollTop <= 0)
        // 2. 確保觸摸目標不是「橫向捲動」的元素 (如日期條)
        const isScrollTop = el.scrollTop <= 0;
        const target = e.target;
        const horizontalScrollable = target.closest('.overflow-x-auto');
        
        // 只有當「在頂部」且「不在橫向捲動區」時才允許下拉
        gesture.allowPull = isScrollTop && !horizontalScrollable;

        gesture.inSelectable = !!e.target.closest('.allow-select'); gesture.selectIntent = false; clearLongPress();
        if (gesture.inSelectable) gesture.longPressTimer = setTimeout(() => { gesture.selectIntent = true; }, 220);
        gesture.blocked = isBlockedTarget(e.target);
      };

      const onTouchMove = (e) => {
        if (!gesture.active || gesture.blocked) return;
        const t = e.touches[0]; const dx = t.clientX - gesture.startX; const dy = t.clientY - gesture.startY;
        gesture.dx = dx; gesture.dy = dy;
        
        if (gesture.inSelectable) { if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearLongPress(); }
        if (gesture.inSelectable && (gesture.selectIntent || hasTextSelection())) return;

        if (!gesture.mode) { if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; gesture.mode = (Math.abs(dx) > Math.abs(dy)) ? 'h' : 'v'; }
        
        if (gesture.mode === 'h') { 
            if ((gesture.startedAtLeftEdge || gesture.startedAtRightEdge) && e.cancelable) e.preventDefault(); 
        } 
        else if (gesture.mode === 'v') {
          // 下拉判定：必須 allowPull 且 dy > 0 (向下拉)
          if (gesture.allowPull && dy > 0) { 
             if (e.cancelable) e.preventDefault(); // 阻止原生捲動
             pullDistance.value = Math.min(80, Math.pow(dy, 0.75)); // 增加阻尼感與最大距離
          } else { 
             pullDistance.value = 0; 
          }
        }
      };

      const onTouchEnd = () => {
        if (!gesture.active) return; gesture.active = false; clearLongPress();
        
        // 觸發更新
        if (pullDistance.value > 65) { 
            pullDistance.value = 65; 
            isPullRefreshing.value = true; 
            loadData(); // 呼叫更新
        } else { 
            pullDistance.value = 0; 
        }

        if (gesture.mode === 'h' && Math.abs(gesture.dx) > 60) {
           if (!gesture.inSelectable || (!gesture.selectIntent && !hasTextSelection())) {
               if (gesture.startedAtLeftEdge && gesture.dx > 0) { if (tab.value === 'expense') tab.value = 'itinerary'; else if (tab.value === 'analysis') tab.value = 'expense'; }
               else if (gesture.startedAtRightEdge && gesture.dx < 0) { if (tab.value === 'itinerary') tab.value = 'expense'; else if (tab.value === 'expense') changeTabToAnalysis(); }
               else if (tab.value === 'itinerary' && !gesture.startedAtLeftEdge && !gesture.startedAtRightEdge) { if (gesture.dx < 0) switchDay('next'); else switchDay('prev'); }
           }
        }
        gesture.mode = null; gesture.inSelectable = false; gesture.selectIntent = false; gesture.allowPull = false;
      };
      attachGestureListeners._handlers = { onTouchStart, onTouchMove, onTouchEnd };
      el.addEventListener('touchstart', onTouchStart, { passive: true }); el.addEventListener('touchmove',  onTouchMove,  { passive: false }); el.addEventListener('touchend',   onTouchEnd,   { passive: true });
    };
    const detachGestureListeners = () => {
      const el = scrollContainer.value; const h = attachGestureListeners._handlers; if (!el || !h) return;
      el.removeEventListener('touchstart', h.onTouchStart); el.removeEventListener('touchmove', h.onTouchMove); el.removeEventListener('touchend', h.onTouchEnd); attachGestureListeners._handlers = null;
    };

    const saveLocal = (data) => { try { localStorage.setItem('tripData_v36', JSON.stringify({ expenses: expenses.value, itinerary: itinerary.value, members: members.value, rates: rates.value })); localStorage.setItem('syncQueue_v36', JSON.stringify(syncQueue.value)); } catch(e){} };
    const loadLocal = () => {
      const data = localStorage.getItem('tripData_v36'); const q = localStorage.getItem('syncQueue_v36');
      if (q) syncQueue.value = JSON.parse(q);
      if (data) { const parsed = JSON.parse(data); expenses.value = parsed.expenses || []; itinerary.value = parsed.itinerary || []; members.value = parsed.members || []; rates.value = parsed.rates || {}; return true; }
      return false;
    };
    const getBackendActionName = (type, action) => { if (action === 'delete') return 'deleteRow'; return action + (type === 'itin' ? 'Itinerary' : 'Expense'); };
    const updateLocalData = (res) => { if (res && res.expenses) { expenses.value = res.expenses; itinerary.value = res.itinerary; members.value = res.members; rates.value = res.rates; saveLocal({}); if (tab.value === 'analysis') scheduleRenderChart(); } };
    const processSyncQueue = async () => {
      if (syncQueue.value.length === 0 || !navigator.onLine || isSyncing.value) return; isSyncing.value = true;
      const queue = [...syncQueue.value]; const remaining = [];
      for (const job of queue) { try { const apiAction = getBackendActionName(job.type, job.action); const res = await callApi(apiAction, job.data, 'POST'); if (res) updateLocalData(res); else remaining.push(job); } catch (e) { remaining.push(job); } }
      syncQueue.value = remaining; saveLocal({}); isSyncing.value = false; if (syncQueue.value.length === 0) loadData();
    };
    const handleCRUD = async (type, action, data) => {
       if (navigator.onLine) { isSyncing.value = true; try { const apiAction = getBackendActionName(type, action); const res = await callApi(apiAction, data, 'POST'); if (!res) throw new Error("API Fail"); updateLocalData(res); } catch (e) { syncQueue.value.push({ type, action, data }); } finally { isSyncing.value = false; } } else { syncQueue.value.push({ type, action, data }); } saveLocal({});
    };
    const loadData = async () => {
      if (!isPullRefreshing.value) isLoading.value = true;
      if (loadLocal()) { if (isFirstLoad.value) { nextTick(() => checkAndScrollToToday()); isFirstLoad.value = false; } if (tab.value === 'analysis') scheduleRenderChart(); setTimeout(() => { if (!isPullRefreshing.value) isLoading.value = false; }, 150); }
      if (!navigator.onLine) { isLoading.value = false; isPullRefreshing.value = false; pullDistance.value = 0; return; }
      try { 
          const res = await callApi('getData'); 
          updateLocalData(res); 
      } catch(e) { 
      } finally { 
          isLoading.value = false; 
          // 確保動畫結束後重置
          setTimeout(() => {
             isPullRefreshing.value = false; 
             pullDistance.value = 0; 
          }, 300);
      }
    };
    const selectDate = (date) => { selDate.value = date; scrollToDateBtn(date); if(scrollContainer.value) scrollContainer.value.scrollTop = 0; };
    const scrollToDateBtn = (date) => { nextTick(() => { const btn = document.getElementById('date-btn-' + date); if (btn && dateContainer.value) { const centerPos = (btn.offsetLeft - dateContainer.value.offsetLeft) - (dateContainer.value.clientWidth / 2) + (btn.clientWidth / 2); dateContainer.value.scrollTo({ left: centerPos, behavior: 'smooth' }); } }); };
    const checkAndScrollToToday = () => { const d = new Date(); const offset = d.getTimezoneOffset() * 60000; const todayStr = new Date(d.getTime() - offset).toISOString().split('T')[0]; if (tripDates.some(x => x.date === todayStr)) selectDate(todayStr); else selectDate(tripDates[0].date); };
    const switchDay = (direction) => { const idx = tripDates.findIndex(d => d.date === selDate.value); if (direction === 'next' && idx < tripDates.length - 1) selectDate(tripDates[idx + 1].date); if (direction === 'prev' && idx > 0) selectDate(tripDates[idx - 1].date); };
    const getDayInfo = (dStr) => { const d = new Date(dStr); const diff = Math.ceil((d - startDate)/86400000) + 1; return `DAY ${diff} · ${['週日','週一','週二','週三','週四','週五','週六'][d.getDay()]}`; };
    const getEvents = (d) => itinerary.value.filter(e => e.date === d).sort((a,b)=>a.startTime.localeCompare(b.startTime));
    const formatNumber = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const uniqueExpDates = computed(() => [...new Set(expenses.value.map(e => e.date))].sort());
    const uniqueItems = computed(() => [...new Set(expenses.value.map(e => e.item))].filter(Boolean));
    const uniqueLocations = computed(() => [...new Set(expenses.value.map(e => e.location))].filter(Boolean));
    const uniquePayments = computed(() => [...new Set(expenses.value.map(e => e.payment))].filter(Boolean));
    const hasActiveFilters = computed(() => Object.values(filters.value).some(v => v !== 'ALL'));
    const resetFilters = () => { filters.value = { date: 'ALL', item: 'ALL', payer: 'ALL', location: 'ALL', payment: 'ALL' }; };
    const filteredExpenses = computed(() => { return expenses.value.filter(e => { if (filters.value.date !== 'ALL' && e.date !== filters.value.date) return false; if (filters.value.item !== 'ALL' && e.item !== filters.value.item) return false; if (filters.value.payer !== 'ALL' && e.payer !== filters.value.payer) return false; if (filters.value.location !== 'ALL' && e.location !== filters.value.location) return false; if (filters.value.payment !== 'ALL' && e.payment !== filters.value.payment) return false; return true; }); });
    const getAmountTWD = (exp) => { if (exp.amountTWD && exp.amountTWD > 0) return exp.amountTWD; return Math.round(exp.amount * (rates.value[exp.currency] || 1)); };
    const publicSpent = computed(() => { return expenses.value.reduce((sum, e) => { const amt = getAmountTWD(e); if (!e.involved || e.involved.length === 0) return sum; const perShare = amt / e.involved.length; let bill = 0; if (e.involved.includes('家齊')) bill += perShare; if (e.involved.includes('亭穎')) bill += perShare; return sum + bill; }, 0); });
    const momSpent = computed(() => { return expenses.value.reduce((sum, e) => { const amt = getAmountTWD(e); if (e.involved && e.involved.includes('媽媽')) return sum + (amt / e.involved.length); return sum; }, 0); });
    const debts = computed(() => { if (members.value.length === 0) return []; const bal = {}; members.value.forEach(m => bal[m] = 0); expenses.value.forEach(e => { const amt = getAmountTWD(e); const split = e.involved || []; if (split.length > 0) { bal[e.payer] += amt; const share = amt / split.length; split.forEach(p => { if (bal[p] !== undefined) bal[p] -= share; }); } }); let debtors=[], creditors=[]; for (const m in bal) { if (bal[m] < -1) debtors.push({p:m, a:bal[m]}); if (bal[m] > 1) creditors.push({p:m, a:bal[m]}); } debtors.sort((a,b)=>a.a-b.a); creditors.sort((a,b)=>b.a-a.a); const res=[]; let i=0, j=0; while(i<debtors.length && j<creditors.length){ const d=debtors[i], c=creditors[j]; const amt=Math.min(Math.abs(d.a), c.a); res.push({from:d.p, to:c.p, amount:Math.round(amt)}); d.a += amt; c.a -= amt; if (Math.abs(d.a)<1) i++; if (c.a<1) j++; } return res; });

    /* Chart Logic (Morandi Macaron) */
    let chartInstance = null; const chartBusy = ref(false); let chartTimer = null;
    const buildStats = () => { const stats = {}; const list = filteredExpenses.value; for (let i=0;i<list.length;i++){ const e = list[i]; const key = e.item || '其他'; stats[key] = (stats[key] || 0) + getAmountTWD(e); } return stats; };
    const renderChart = () => {
      const canvas = document.getElementById('expenseChart'); if (!canvas) return;
      const stats = buildStats(); const labels = Object.keys(stats); const data = Object.values(stats);
      // Morandi Macaron Colors
      const nordicColors = ['#9DB6CC', '#DBCFB0', '#B5A8BF', '#D4A5A5', '#99A799', '#C4C4C4', '#89A8B2'];
      if (chartInstance) { chartInstance.data.labels = labels; chartInstance.data.datasets[0].data = data; chartInstance.data.datasets[0].backgroundColor = labels.map((_,i)=>nordicColors[i % nordicColors.length]); chartInstance.update('none'); } 
      else { chartInstance = new Chart(canvas, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: labels.map((_,i)=>nordicColors[i % nordicColors.length]), borderWidth: 0, hoverOffset: 4 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', animation: { duration: 800 }, plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 11, weight: 'bold' }, color: '#64748b', usePointStyle: true, padding: 12, boxWidth: 8 } } } } }); }
      chartBusy.value = false;
    };
    const scheduleRenderChart = async () => { if (tab.value !== 'analysis') return; chartBusy.value = true; if (chartTimer) clearTimeout(chartTimer); chartTimer = setTimeout(() => { nextTick(() => { renderChart(); }); }, 300); };
    const changeTabToAnalysis = async () => { tab.value = 'analysis'; if (chartInstance) { chartInstance.destroy(); chartInstance = null; } scheduleRenderChart(); };
    watch(tab, (val) => { if (val === 'analysis') scheduleRenderChart(); if (val === 'expense') newExp.value = { payer: '', location: '', item: '', payment: '', currency: 'NTD', amount: null, involved: [], note: '' }; });
    watch(filters, () => { if (tab.value === 'analysis') scheduleRenderChart(); }, { deep: true });
    watch(expenses, () => { if (tab.value === 'analysis') scheduleRenderChart(); }, { deep: true });

    const openRateModal = () => { tempRates.value = { ...rates.value }; showRateModal.value = true; };
    const openAddItin = () => { itinForm.value = { row: null, startTime: '09:00', endTime: '', category: '景點', title: '', location: '', link: '', note: '', imgUrl: '', newImageBase64: null, deleteImage: false, imgId: '' }; isEditing.value = false; showItinModal.value = true; };
    const openEditItin = (evt) => { itinForm.value = { ...evt, newImageBase64: null, deleteImage: false }; isEditing.value = true; showItinModal.value = true; };
    const openEditExp = (exp) => { editExpForm.value = JSON.parse(JSON.stringify(exp)); showExpModal.value = true; };
    const handleImageUpload = (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (evt) => { itinForm.value.imgUrl = evt.target.result; itinForm.value.newImageBase64 = evt.target.result; itinForm.value.deleteImage = false; }; reader.readAsDataURL(file); };
    const removeImage = () => { itinForm.value.imgUrl = ''; itinForm.value.newImageBase64 = null; itinForm.value.deleteImage = true; };
    const viewImage = (url) => { viewingImg.value = url; showImgViewer.value = true; imgGesture.value = { startX: 0, startY: 0, currentX: 0, currentY: 0, scale: 1, isPulling: false, isZooming: false, startDistance: 0 }; };
    const closeImgViewer = () => { if (imgViewerEl.value) imgViewerEl.value.style.transform = ''; document.querySelector('.img-viewer-overlay').style.backgroundColor = ''; showImgViewer.value = false; };
    const deleteItin = async (evt) => { if(!confirm('確定刪除?')) return; itinerary.value = itinerary.value.filter(x => x.row !== evt.row); const pendingIdx = syncQueue.value.findIndex(job => job.type === 'itin' && job.action === 'add' && job.data.row === evt.row); if (pendingIdx !== -1) { syncQueue.value.splice(pendingIdx, 1); saveLocal({}); } else { handleCRUD('itin', 'delete', { row: evt.row, sheetName: 'Itinerary' }); } };
    const deleteExp = async (exp) => { if(!confirm('確定刪除?')) return; expenses.value = expenses.value.filter(x => x.row !== exp.row); const pendingIdx = syncQueue.value.findIndex(job => job.type === 'exp' && job.action === 'add' && job.data.row === exp.row); if (pendingIdx !== -1) { syncQueue.value.splice(pendingIdx, 1); saveLocal({}); } else { handleCRUD('exp', 'delete', { row: exp.row, sheetName: 'Expenses' }); } };
    const submitItin = async () => { if(!itinForm.value.title) return alert('請輸入標題'); const newRow = isEditing.value ? itinForm.value.row : Date.now(); const payload = { ...itinForm.value, row: newRow, date: selDate.value }; if(isEditing.value) { const idx = itinerary.value.findIndex(x => x.row === newRow); if(idx !== -1) itinerary.value[idx] = payload; handleCRUD('itin', 'edit', payload); } else { itinerary.value.push(payload); handleCRUD('itin', 'add', payload); } showItinModal.value = false; };
    const submitExp = async () => { if(!newExp.value.amount || !newExp.value.item) return alert('請輸入金額與項目'); const payload = { ...newExp.value, row: Date.now(), date: new Date().toISOString().split('T')[0], time: new Date().toTimeString().slice(0,5), amountTWD: Math.round(newExp.value.amount * (rates.value[newExp.value.currency] || 1)) }; expenses.value.unshift(payload); handleCRUD('exp', 'add', payload); newExp.value.amount = null; newExp.value.item = ''; newExp.value.note = ''; newExp.value.involved = []; alert('記帳成功'); };
    const submitEditExp = async () => { const idx = expenses.value.findIndex(e => e.row === editExpForm.value.row); if(idx === -1) return; const updated = { ...editExpForm.value }; updated.amountTWD = Math.round(updated.amount * (rates.value[updated.currency] || 1)); expenses.value[idx] = updated; showExpModal.value = false; handleCRUD('exp', 'edit', updated); };
    const saveRates = () => { rates.value = { ...tempRates.value }; saveLocal({}); showRateModal.value = false; callApi('updateRates', rates.value, 'POST'); };
    const confirmClearSync = () => { if(confirm('確定要強制清空所有待上傳資料嗎？\n注意：這會導致離線新增的資料無法同步到伺服器。')) { syncQueue.value = []; saveLocal({}); } };
    const toggleSelectAll = () => { if(newExp.value.involved.length === members.value.length) newExp.value.involved=[]; else newExp.value.involved=[...members.value]; };
    const toggleSelectAllEdit = () => { if(!editExpForm.value.involved) editExpForm.value.involved = []; if(editExpForm.value.involved.length === members.value.length) editExpForm.value.involved=[]; else editExpForm.value.involved=[...members.value]; };
    const updateOnlineStatus = () => { isOnline.value = navigator.onLine; if (isOnline.value) processSyncQueue(); };
    const isItemPending = (rowId) => { return syncQueue.value.some(job => job.data.row === rowId); };
    onMounted(async () => { initDate(); window.addEventListener('online', updateOnlineStatus); window.addEventListener('offline', updateOnlineStatus); await nextTick(); attachGestureListeners(); loadData(); if(navigator.onLine) processSyncQueue(); });
    onBeforeUnmount(() => { detachGestureListeners(); window.removeEventListener('online', updateOnlineStatus); window.removeEventListener('offline', updateOnlineStatus); if (chartInstance) { chartInstance.destroy(); chartInstance = null; } });
    
    return {
      tab, isLoading, isOnline, isSyncing, syncQueue, dateContainer, scrollContainer, todayDate, todayWeekday, pullDistance, isPullRefreshing, refreshText, tripStatus, tripDates, selDate, itinerary, selectDate, getDayInfo, getEvents, getCategoryBorderClass, getExpenseBorderClass, expenses, rates, members, filters, showFilterMenu, uniqueExpDates, uniqueItems, uniqueLocations, uniquePayments, resetFilters, hasActiveFilters, filteredExpenses, formatNumber, getAmountTWD, publicSpent, momSpent, debts, getItemTagClass, chartBusy, changeTabToAnalysis, showRateModal, showItinModal, showExpModal, isEditing, itinForm, newExp, editExpForm, tempRates, openRateModal, openAddItin, openEditItin, openEditExp, deleteItin, deleteExp, submitItin, submitExp, submitEditExp, saveRates, confirmClearSync, toggleSelectAll, toggleSelectAllEdit, isItemPending, handleImageUpload, removeImage, viewImage, closeImgViewer, showImgViewer, viewingImg, imgViewerEl, handleImgTouchStart, handleImgTouchMove, handleImgTouchEnd, imgGesture, toggleZoom, formatNote
    };
  }
}).mount('#app');
