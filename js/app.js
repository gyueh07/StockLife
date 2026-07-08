import { auth, db } from "./firebase.js";
import { getAllStockViews, getStockView, getNextTickText, LISTING_TEXT } from "./market.js";
import { STOCKS } from "./data.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  runTransaction,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const STARTING_CASH = 1000000;
const INTERNAL_DOMAIN = "stocklifegame.com";

function normalizeLoginName(name){
  return (name || "").trim();
}

function nameToInternalEmail(name){
  const clean = normalizeLoginName(name);
  if(!clean) return "";
  const encoded = btoa(unescape(encodeURIComponent(clean)))
    .replaceAll("+", "p")
    .replaceAll("/", "s")
    .replaceAll("=", "")
    .toLowerCase();
  return `user-${encoded}@${INTERNAL_DOMAIN}`;
}

const state = {
  uid:null,
  email:"",
  user:{
    nickname:"투자자",
    startingCash:STARTING_CASH,
    cash:STARTING_CASH,
    holdings:{},
    favorites:[],
    tradeCount:0,
    history:[],
    totalAsset:STARTING_CASH
  },
  screen:"authScreen",
  filter:"all",
  currentStock:null,
  chartRange:"1h",
  currentChartValues:[],
  tradeType:"buy",
  qty:1,
  sort:"name",
  tradeSubmitting:false,
  authSubmitting:false
};

let tradeAlertTimer = null;
let saveQueue = Promise.resolve();
let rankUnsubscribe = null;
let lastRankAssetSyncBucket = null;

const titles = {
  homeScreen:"홈",
  marketScreen:"시장",
  detailScreen:"종목",
  walletScreen:"지갑",
  rankScreen:"랭킹",
  profileScreen:"프로필"
};

function won(v){ return Math.round(finiteNumber(v, 0)).toLocaleString("ko-KR") + " 원"; }
function signWon(v){ return (v > 0 ? "+" : "") + won(v); }
function rate(v){ return (v > 0 ? "+" : "") + finiteNumber(v, 0).toFixed(2) + "%"; }
function cls(v){ return v > 0 ? "up" : v < 0 ? "down" : "flat"; }

function toast(msg){
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(()=>$("toast").classList.remove("show"), 1700);
}

function showTradeAlert(type, name, qty, price, amount){
  const el = $("tradeAlert");
  if(!el){
    toast(`${type} 완료`);
    return;
  }

  const isBuy = type === "매수";
  el.classList.remove("hidden", "buy-alert", "sell-alert", "show");
  el.classList.add(isBuy ? "buy-alert" : "sell-alert");
  el.querySelector(".trade-alert-icon").textContent = type;
  el.querySelector(".trade-alert-title").textContent = `${name} ${type} 완료`;
  el.querySelector(".trade-alert-meta").textContent = `${qty}주 · 단가 ${won(price)}`;
  el.querySelector(".trade-alert-amount").textContent = won(amount);

  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(tradeAlertTimer);
  tradeAlertTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.classList.add("hidden"), 240);
  }, 2600);
}

function setAuthError(msg=""){
  const el = $("authError");
  if(!el) return;
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

function loading(show){
  $("loadingOverlay").classList.toggle("hidden", !show);
}

function finiteNumber(value, fallback=0){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeQty(value){
  return Math.max(1, Math.floor(finiteNumber(value, 1)));
}

function normalizeHoldings(holdings){
  const clean = {};
  Object.entries(holdings || {}).forEach(([id, h]) => {
    const shares = Math.floor(finiteNumber(h?.shares, 0));
    const avg = finiteNumber(h?.avg, 0);
    if(shares > 0 && avg >= 0){
      clean[id] = {shares, avg};
    }
  });
  return clean;
}

function normalizeUser(raw={}, fallbackName="투자자"){
  const user = {
    nickname: fallbackName,
    startingCash:STARTING_CASH,
    cash:STARTING_CASH,
    holdings:{},
    favorites:[],
    tradeCount:0,
    history:[],
    totalAsset:STARTING_CASH,
    ...raw
  };

  user.startingCash = finiteNumber(user.startingCash, STARTING_CASH);
  user.cash = finiteNumber(user.cash, STARTING_CASH);
  user.holdings = normalizeHoldings(user.holdings);
  user.favorites = Array.isArray(user.favorites) ? user.favorites : [];
  user.history = Array.isArray(user.history) ? user.history.slice(0,20) : [];
  user.tradeCount = Math.max(0, Math.floor(finiteNumber(user.tradeCount, 0)));
  user.totalAsset = finiteNumber(user.totalAsset, user.cash);
  user.nickname = user.nickname || fallbackName;
  return user;
}

function holding(id){
  const h = state.user.holdings?.[id] || {};
  return {
    shares:Math.max(0, Math.floor(finiteNumber(h.shares, 0))),
    avg:finiteNumber(h.avg, 0)
  };
}

function stockValueForHoldings(holdings){
  const cleanHoldings = normalizeHoldings(holdings);
  const value = getAllStockViews().reduce((sum,s)=>{
    const h = cleanHoldings[s.id] || {shares:0};
    return sum + h.shares * s.price;
  }, 0);
  return finiteNumber(value, 0);
}

function stockValue(){
  return stockValueForHoldings(state.user.holdings);
}

function stockCostBasis(){
  const value = Object.values(state.user.holdings || {}).reduce((sum, h) => {
    const shares = Math.max(0, Math.floor(finiteNumber(h?.shares, 0)));
    const avg = finiteNumber(h?.avg, 0);
    return sum + shares * avg;
  }, 0);
  return finiteNumber(value, 0);
}

function totalAsset(){
  return finiteNumber(state.user.cash, 0) + stockValue();
}

function totalProfit(){
  return totalAsset() - (state.user.startingCash || STARTING_CASH);
}

async function save(refreshRank=false, updateRankAfterSave=true){
  if(!state.uid) return;

  const currentTotal = totalAsset();
  state.user.totalAsset = currentTotal;
  state.user = normalizeUser(state.user, state.user.loginName || state.user.nickname || "투자자");

  const payload = {
    ...state.user,
    totalAsset: currentTotal,
    updatedAt: serverTimestamp()
  };

  saveQueue = saveQueue
    .catch(() => {})
    .then(() => setDoc(doc(db, "users", state.uid), payload));
  await saveQueue;

  if(updateRankAfterSave && (refreshRank || state.screen === "rankScreen")){
    await renderRank(false);
  }
}

function makeHistoryItem(type, name, qty, amount){
  return {
    type, name, qty, amount,
    time:new Date().toLocaleString("ko-KR", {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"})
  };
}

async function commitTrade(stock, tradeType, qty, price){
  if(!state.uid) throw new Error("not-signed-in");

  await saveQueue.catch(() => {});

  const ref = doc(db, "users", state.uid);
  const tradeLabel = tradeType === "buy" ? "매수" : "매도";
  const amount = price * qty;
  let nextUser = null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const serverUser = snap.exists() ? snap.data() : {};
    const user = normalizeUser({
      ...state.user,
      ...serverUser
    }, state.user.loginName || state.user.nickname || "투자자");

    if(!user.loginName && state.user.loginName) user.loginName = state.user.loginName;
    if(!user.email && state.user.email) user.email = state.user.email;

    const h = user.holdings?.[stock.id] || {shares:0, avg:0};

    if(tradeType === "buy"){
      if(user.cash < amount) throw new Error("insufficient-cash");
      const newShares = h.shares + qty;
      const newAvg = ((h.avg*h.shares) + amount) / newShares;
      user.cash -= amount;
      user.holdings[stock.id] = {shares:newShares, avg:newAvg};
    }else{
      if(h.shares < qty) throw new Error("insufficient-shares");
      user.cash += amount;
      const remain = h.shares - qty;
      if(remain <= 0) delete user.holdings[stock.id];
      else user.holdings[stock.id] = {shares:remain, avg:h.avg};
    }

    user.tradeCount = (user.tradeCount || 0) + 1;
    user.history = [makeHistoryItem(tradeLabel, stock.name, qty, amount), ...(user.history || [])].slice(0,20);
    user.totalAsset = user.cash + stockValueForHoldings(user.holdings);

    const payload = {
      ...normalizeUser(user, user.loginName || user.nickname || "투자자"),
      totalAsset:user.totalAsset,
      updatedAt:serverTimestamp()
    };

    tx.set(ref, payload);
    nextUser = {
      ...payload,
      updatedAt:new Date().toISOString()
    };
  });

  state.user = normalizeUser(nextUser, nextUser?.loginName || nextUser?.nickname || "투자자");
  saveQueue = Promise.resolve();
  return {tradeLabel, amount};
}

function stopRankRealtime(){
  if(rankUnsubscribe){
    rankUnsubscribe();
    rankUnsubscribe = null;
  }
}

function show(screen){
  state.screen = screen;
  if(screen !== "rankScreen") stopRankRealtime();
  document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active", s.id === screen));

  const isApp = screen !== "authScreen";
  $("header").classList.toggle("hidden", !isApp);
  $("nav").classList.toggle("hidden", !isApp);
  $("pageTitle").textContent = titles[screen] || "홈";
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.route === screen));

  if(screen === "homeScreen") renderHome();
  if(screen === "marketScreen") renderMarket();
  if(screen === "walletScreen") renderWallet();
  if(screen === "rankScreen") renderRank();
  if(screen === "profileScreen") renderProfile();
}

document.querySelectorAll("[data-route]").forEach(btn=>btn.addEventListener("click",()=>show(btn.dataset.route)));

if($("listingTime")){
  $("listingTime").textContent = LISTING_TEXT;
}

$("profileQuick").onclick = () => show("profileScreen");

$("showSignup").onclick = () => {
  $("loginBox").classList.add("hidden");
  $("signupBox").classList.remove("hidden");
};
$("showLogin").onclick = () => {
  $("signupBox").classList.add("hidden");
  $("loginBox").classList.remove("hidden");
};

$("signupBtn").onclick = async () => {
  if(state.authSubmitting) return;
  setAuthError("");
  const loginName = $("signupName").value.trim();
  const password = $("signupPassword").value.trim();
  const email = nameToInternalEmail(loginName);

  if(!loginName || password.length < 6){
    setAuthError("이름과 비밀번호 6자 이상 입력");
    toast("이름과 비밀번호 6자 이상 입력");
    return;
  }

  try{
    state.authSubmitting = true;
    $("signupBtn").disabled = true;
    loading(true);
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    state.uid = cred.user.uid;
    state.email = email;
    state.user = normalizeUser({
      nickname: loginName,
      loginName,
      email,
      startingCash:STARTING_CASH,
      cash:STARTING_CASH,
      holdings:{},
      favorites:[],
      tradeCount:0,
      history:[],
      totalAsset:STARTING_CASH,
      createdAt:new Date().toISOString(),
      updatedAt:serverTimestamp()
    }, loginName);

    await setDoc(doc(db, "users", cred.user.uid), state.user, { merge:true });
    renderAll();
    show("homeScreen");
    toast("회원가입 완료");
  }catch(e){
    console.error(e);
    const msg = errorMessage(e);
    setAuthError(msg);
    toast(msg);
  }finally{
    state.authSubmitting = false;
    $("signupBtn").disabled = false;
    loading(false);
  }
};

$("loginBtn").onclick = async () => {
  if(state.authSubmitting) return;
  setAuthError("");
  const loginName = $("loginName").value.trim();
  const password = $("loginPassword").value.trim();
  const email = nameToInternalEmail(loginName);

  if(!loginName || !password){
    setAuthError("이름과 비밀번호를 입력하세요");
    toast("이름과 비밀번호 입력");
    return;
  }

  try{
    state.authSubmitting = true;
    $("loginBtn").disabled = true;
    loading(true);
    const cred = await signInWithEmailAndPassword(auth, email, password);

    state.uid = cred.user.uid;
    state.email = email;

    const ref = doc(db, "users", cred.user.uid);
    const snap = await getDoc(ref);

    if(snap.exists()){
      state.user = normalizeUser({...state.user, ...snap.data()}, loginName);
    }else{
      state.user = normalizeUser({
        nickname: loginName,
        loginName,
        email,
        startingCash:STARTING_CASH,
        cash:STARTING_CASH,
        holdings:{},
        favorites:[],
        tradeCount:0,
        history:[],
        totalAsset:STARTING_CASH,
        createdAt:new Date().toISOString(),
        updatedAt:serverTimestamp()
      }, loginName);
      await setDoc(ref, state.user, { merge:true });
    }

    if(!state.user.loginName) state.user.loginName = loginName;
    if(!state.user.nickname || state.user.nickname === "투자자") state.user.nickname = loginName;

    await save(false, false);

    renderAll();
    show("homeScreen");
    toast("로그인 완료");
  }catch(e){
    console.error(e);
    const msg = errorMessage(e);
    setAuthError(msg);
    toast(msg);
  }finally{
    state.authSubmitting = false;
    $("loginBtn").disabled = false;
    loading(false);
  }
};

$("logoutBtn").onclick = async () => {
  await signOut(auth);
  show("authScreen");
};

onAuthStateChanged(auth, async (user) => {
  if(!user){
    state.uid = null;
    loading(false);
    return;
  }

  if(state.authSubmitting) return;
  if(state.screen !== "authScreen") return;

  try{
    loading(true);
    state.uid = user.uid;
    state.email = user.email || "";

    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if(snap.exists()){
      state.user = normalizeUser({...state.user, ...snap.data()}, snap.data()?.loginName || "투자자");
      renderAll();
      show("homeScreen");
    }
  }catch(e){
    console.error(e);
    setAuthError(errorMessage(e));
  }finally{
    loading(false);
  }
});

function errorMessage(e){
  const c = e?.code || "";
  if(c.includes("email-already-in-use")) return "이미 사용 중인 이름입니다. 로그인으로 들어가세요.";
  if(c.includes("invalid-email")) return "이름 처리 중 오류가 났습니다.";
  if(c.includes("weak-password")) return "비밀번호는 6자 이상이어야 합니다.";
  if(c.includes("user-not-found")) return "없는 이름입니다. 먼저 회원가입하세요.";
  if(c.includes("wrong-password")) return "비밀번호가 틀렸습니다.";
  if(c.includes("invalid-credential")) return "이름 또는 비밀번호가 틀렸습니다.";
  if(c.includes("missing-password")) return "비밀번호를 입력하세요.";
  if(c.includes("operation-not-allowed")) return "Firebase에서 Email/Password 로그인을 켜야 합니다.";
  if(c.includes("permission-denied")) return "Firestore 규칙 때문에 저장을 못 했습니다.";
  if(c.includes("network-request-failed")) return "네트워크 연결을 확인하세요.";
  return "오류: " + c;
}

function stockRow(s){
  const h = holding(s.id);
  const up = s.change >= 0;
  return `
    <div class="stock-row" data-stock="${s.id}">
      <div>
        <b>${h.shares > 0 ? "💼 " : ""}${s.name}</b>
        <p>${won(s.price)}${h.shares > 0 ? ` · 보유 ${h.shares}주` : ""}</p>
      </div>
      <strong class="${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(s.change).toFixed(2)}%</strong>
    </div>
  `;
}

function bindRows(root=document){
  root.querySelectorAll("[data-stock]").forEach(row=>{
    row.onclick = () => openStock(row.dataset.stock);
  });
}

function animateNumber(el, target){
  const numeric = parseInt((el.dataset.value || "0"), 10);
  const start = Number.isFinite(numeric) ? numeric : 0;
  const duration = 420;
  const begin = performance.now();

  function tick(now){
    const t = Math.min(1, (now - begin) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = start + (target - start) * eased;
    el.textContent = won(value);
    if(t < 1) requestAnimationFrame(tick);
    else el.dataset.value = Math.round(target);
  }
  requestAnimationFrame(tick);
}

function renderHome(){
  const total = totalAsset();
  const sv = stockValue();

  animateNumber($("totalAsset"), total);
  $("cashValue").textContent = won(state.user.cash);
  $("stockValue").textContent = won(sv);

  const favs = getAllStockViews().filter(s=>state.user.favorites?.includes(s.id));
  $("favoriteSummary").textContent = `${favs.length}개`;
  if(!favs.length){
    $("favoriteList").className = "empty";
    $("favoriteList").innerHTML = "관심 종목이 없습니다.";
  }else{
    $("favoriteList").className = "";
    $("favoriteList").innerHTML = favs.map(stockRow).join("");
    bindRows($("favoriteList"));
  }

  const hot = getAllStockViews().sort((a,b)=>b.change-a.change).slice(0,3);
  $("hotList").innerHTML = hot.map(stockRow).join("");
  bindRows($("hotList"));
}

function renderMarket(){
  const keyword = $("searchInput").value.trim();
  let list = getAllStockViews().filter(s=>!keyword || s.name.includes(keyword));

  if(state.filter === "up") list = list.filter(s=>s.change >= 0);
  if(state.filter === "down") list = list.filter(s=>s.change < 0);
  if(state.filter === "hold") list = list.filter(s=>holding(s.id).shares > 0);

  if(state.sort === "price") list.sort((a,b)=>b.price-a.price);
  if(state.sort === "change") list.sort((a,b)=>b.change-a.change);
  if(state.sort === "name") list.sort((a,b)=>a.name.localeCompare(b.name, "ko"));

  let html = "";
  if(state.filter === "all" && !keyword){
    const favIds = state.user.favorites || [];
    const favs = list.filter(s=>favIds.includes(s.id));
    const rest = list.filter(s=>!favIds.includes(s.id));
    if(favs.length){
      html += `<div class="favorite-section-title">★ 관심 종목</div>`;
      html += favs.map(stockRow).join("");
      html += `<div class="market-divider"></div>`;
    }
    html += rest.map(stockRow).join("");
  }else{
    html = list.map(stockRow).join("");
  }

  $("marketList").innerHTML = html || `<div class="empty">표시할 종목이 없습니다.</div>`;
  bindRows($("marketList"));
}

$("searchInput").oninput = renderMarket;
document.querySelectorAll(".tab").forEach(btn=>{
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.filter;
    renderMarket();
  };
});
$("sortBtn").onclick = () => {
  state.sort = state.sort === "name" ? "price" : state.sort === "price" ? "change" : "name";
  toast(`정렬: ${state.sort === "name" ? "이름순" : state.sort === "price" ? "현재가순" : "상승률순"}`);
  renderMarket();
};

function openStock(id){
  const base = STOCKS.find(x => x.id === id);
  const s = getStockView(base, state.chartRange);
  if(!s) return;
  state.currentStock = s;

  $("detailName").textContent = s.name;
  $("detailPrice").textContent = won(s.price);
  $("detailChange").textContent = `${s.change >= 0 ? "▲" : "▼"} ${Math.abs(s.change).toFixed(2)}%`;
  $("detailChange").className = s.change >= 0 ? "up" : "down";

  const h = holding(s.id);
  $("detailShares").textContent = `${h.shares}주`;
  $("detailAvg").textContent = h.shares ? won(h.avg) : "-";
  const profit = (s.price - h.avg) * h.shares;
  const profitRate = h.shares ? ((s.price - h.avg) / h.avg) * 100 : 0;
  $("detailProfit").textContent = h.shares ? signWon(profit) : "-";
  $("detailProfit").className = cls(profit);
  $("detailRate").textContent = h.shares ? rate(profitRate) : "-";
  $("detailRate").className = cls(profitRate);

  const fav = state.user.favorites?.includes(s.id);
  $("favoriteBtn").textContent = fav ? "★" : "☆";
  $("favoriteBtn").classList.toggle("on", fav);

  drawChart(s.chart);
  show("detailScreen");
}

document.querySelectorAll(".chart-tab").forEach(btn=>{
  btn.onclick = () => {
    document.querySelectorAll(".chart-tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.chartRange = btn.dataset.range;
    if(state.currentStock) openStock(state.currentStock.id);
  };
});

$("favoriteBtn").onclick = async () => {
  const id = state.currentStock?.id;
  if(!id) return;
  state.user.favorites ||= [];
  if(state.user.favorites.includes(id)){
    state.user.favorites = state.user.favorites.filter(x=>x!==id);
    toast("관심 종목에서 제거");
  }else{
    state.user.favorites.push(id);
    toast("관심 종목에 추가");
  }
  await save(false);
  openStock(id);
  renderHome();
};

function drawChart(pointsData){
  state.currentChartValues = pointsData;
  const prices = pointsData.map(p => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(1, max - min);
  const chartLeft = 22;
  const chartRight = 318;
  const chartTop = 20;
  const chartBottom = 160;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;

  const points = pointsData.map((p,i)=>{
    const denom = Math.max(1, pointsData.length - 1);
    const x = chartLeft + (i / denom) * chartWidth;
    const y = chartBottom - ((p.price - min) / range) * chartHeight;
    p.chartX = x;
    p.chartY = y;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  $("chartLine").setAttribute("points", points);
  $("chartFill").setAttribute("points", `${points} ${chartRight},190 ${chartLeft},190`);
}

const chartWrap = $("chartWrap");
chartWrap.addEventListener("pointermove", (e)=>{
  if(!state.currentChartValues.length) return;

  const rect = chartWrap.getBoundingClientRect();
  const rawX = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
  const idx = Math.round((rawX / rect.width) * (state.currentChartValues.length - 1));
  const point = state.currentChartValues[idx];

  const x = (point.chartX / 340) * rect.width;
  const y = (point.chartY / 190) * rect.height;

  $("crosshair").classList.remove("hidden");
  $("crosshair").querySelector(".v-line").style.left = `${x}px`;
  $("crosshair").querySelector(".h-line").style.top = `${y}px`;
  $("chartDot").style.left = `${x}px`;
  $("chartDot").style.top = `${y}px`;
  $("crosshairTip").style.left = `${x}px`;
  $("crosshairTip").style.top = `${y}px`;
  $("crosshairTip").innerHTML = `${won(point.price)}<small>${point.label}</small>`;
});
chartWrap.addEventListener("pointerleave", ()=>$("crosshair").classList.add("hidden"));

document.querySelectorAll("[data-trade]").forEach(btn=>{
  btn.onclick = () => {
    state.tradeType = btn.dataset.trade;
    state.qty = 1;
    openModal();
  };
});

function openModal(){
  const s = state.currentStock;
  $("modalTitle").textContent = state.tradeType === "buy" ? "매수" : "매도";
  $("modalSub").textContent = `${s.name} · ${won(s.price)}`;
  $("tradeModal").classList.add("show");
  updateModal();
}

function updateModal(){
  const s = state.currentStock;
  const h = holding(s.id);
  const amount = s.price * state.qty;
  const isBuy = state.tradeType === "buy";
  const ok = isBuy ? state.user.cash >= amount : h.shares >= state.qty;

  $("qtyInput").value = state.qty;
  $("modalTotal").textContent = won(amount);
  $("modalTotal").className = ok ? "" : "invalid";
  $("modalCurrentPrice").textContent = won(s.price);

  $("tradeAvailableLabel").textContent = isBuy ? "보유 현금" : "보유 수량";
  $("tradeAvailable").textContent = isBuy ? won(state.user.cash) : `${h.shares}주`;

  $("previewLabel").textContent = isBuy ? "예상 평균단가" : "예상 현금";
  if(isBuy){
    const newShares = h.shares + state.qty;
    const newAvg = ((h.avg * h.shares) + amount) / newShares;
    $("previewAvg").textContent = won(newAvg);
    $("afterLabel").textContent = "매수 후 현금";
    $("afterCash").textContent = won(state.user.cash - amount);
  }else{
    $("previewAvg").textContent = won(state.user.cash + amount);
    $("afterLabel").textContent = "매도 후 현금";
    $("afterCash").textContent = won(state.user.cash + amount);
  }

  let warning = "";
  if(isBuy && !ok) warning = `${won(amount - state.user.cash)} 부족합니다.`;
  if(!isBuy && !ok) warning = `${state.qty - h.shares}주를 초과하여 판매할 수 없습니다.`;
  $("tradeWarning").textContent = warning;
  $("openConfirm").disabled = state.tradeSubmitting || !ok;
}

$("qtyMinus").onclick = () => { state.qty = Math.max(1, state.qty-1); updateModal(); };
$("qtyPlus").onclick = () => { state.qty += 1; updateModal(); };
$("qtyInput").oninput = () => {
  state.qty = normalizeQty($("qtyInput").value);
  updateModal();
};
$("maxBtn").onclick = () => {
  const s = state.currentStock;
  const h = holding(s.id);
  if(state.tradeType === "buy"){
    state.qty = Math.max(1, Math.floor(state.user.cash / s.price));
  }else{
    state.qty = Math.max(1, h.shares);
  }
  updateModal();
};
$("closeModal").onclick = () => $("tradeModal").classList.remove("show");

$("openConfirm").onclick = () => {
  if(state.tradeSubmitting) return;
  const s = state.currentStock;
  state.qty = normalizeQty(state.qty);
  const amount = s.price * state.qty;
  const afterCash = state.tradeType === "buy" ? state.user.cash - amount : state.user.cash + amount;
  $("confirmTitle").textContent = state.tradeType === "buy" ? "매수 확인" : "매도 확인";
  $("confirmSub").textContent = `${s.name}`;
  $("confirmQty").textContent = `${state.qty}주`;
  $("confirmAmount").textContent = won(amount);
  $("confirmAfterCash").textContent = won(afterCash);
  $("confirmTrade").disabled = false;
  $("cancelConfirm").disabled = false;
  $("tradeModal").classList.remove("show");
  $("confirmModal").classList.add("show");
};
$("cancelConfirm").onclick = () => {
  if(state.tradeSubmitting) return;
  $("confirmModal").classList.remove("show");
  $("tradeModal").classList.add("show");
};

$("confirmTrade").onclick = async () => {
  if(state.tradeSubmitting) return;
  state.tradeSubmitting = true;
  $("confirmTrade").disabled = true;
  $("cancelConfirm").disabled = true;

  const s = state.currentStock;
  const price = s.price;
  const qty = normalizeQty(state.qty);
  const amount = price * qty;
  const h = holding(s.id);
  const tradeLabel = state.tradeType === "buy" ? "매수" : "매도";

  try{
    if(state.tradeType === "buy" && state.user.cash < amount) return toast("보유 현금이 부족합니다.");
    if(state.tradeType === "sell" && h.shares < qty) return toast("보유 수량이 부족합니다.");

    const result = await commitTrade(s, state.tradeType, qty, price);
    $("confirmModal").classList.remove("show");
    if(state.screen === "rankScreen") await renderRank(false);
    showTradeAlert(result.tradeLabel, s.name, qty, price, result.amount);
    toast(`${result.tradeLabel} 완료`);
    openStock(s.id);
    renderAll();
  }catch(e){
    console.error(e);
    if(e?.message === "insufficient-cash") toast("보유 현금이 부족합니다.");
    else if(e?.message === "insufficient-shares") toast("보유 수량이 부족합니다.");
    else toast("거래 저장 중 오류가 발생했습니다.");
  }finally{
    state.tradeSubmitting = false;
    $("confirmTrade").disabled = false;
    $("cancelConfirm").disabled = false;
    updateModal();
  }
};

function addHistory(type, name, qty, amount){
  state.user.history ||= [];
  state.user.history.unshift(makeHistoryItem(type, name, qty, amount));
  state.user.history = state.user.history.slice(0,20);
}

function renderWallet(){
  const total = totalAsset();
  const sv = stockValue();
  const costBasis = stockCostBasis();
  const profit = sv - costBasis;
  const profitRate = costBasis > 0 ? (profit / costBasis) * 100 : 0;

  $("walletTotal").textContent = won(total);
  $("walletCash").textContent = won(state.user.cash);
  $("walletStocks").textContent = won(sv);
  $("walletProfit").textContent = signWon(profit);
  $("walletProfit").className = cls(profit);
  $("walletRate").textContent = rate(profitRate);
  $("walletRate").className = cls(profitRate);

  const held = getAllStockViews().filter(s=>holding(s.id).shares > 0);
  $("holdingCount").textContent = `${held.length}개`;

  if(!held.length){
    $("holdingList").className = "empty";
    $("holdingList").innerHTML = "보유 종목이 없습니다.";
  }else{
    $("holdingList").className = "";
    $("holdingList").innerHTML = held.map(s=>{
      const h = holding(s.id);
      const p = (s.price - h.avg) * h.shares;
      const r = ((s.price - h.avg) / h.avg) * 100;
      return `
        <div class="stock-row" data-stock="${s.id}">
          <div>
            <b>${s.name}</b>
            <p>${h.shares}주 · 평균 ${won(h.avg)} · ${rate(r)}</p>
          </div>
          <strong class="${cls(p)}">${signWon(p)}</strong>
        </div>
      `;
    }).join("");
    bindRows($("holdingList"));
  }

  const hist = state.user.history || [];
  if(!hist.length){
    $("historyList").className = "empty";
    $("historyList").innerHTML = "거래 내역이 없습니다.";
  }else{
    $("historyList").className = "";
    $("historyList").innerHTML = hist.map(h=>`
      <div class="history-row">
        <div>
          <b>${h.type} · ${h.name}</b>
          <p>${h.qty}주 · ${h.time}</p>
        </div>
        <strong>${won(h.amount)}</strong>
      </div>
    `).join("");
  }
}

async function renderRank(syncCurrentUser=true){
  try{
    if(syncCurrentUser && state.uid){
      await save(false, false);
    }

    const q = query(collection(db, "users"), orderBy("totalAsset", "desc"), limit(20));
    stopRankRealtime();
    $("rankList").className = "empty";
    $("rankList").innerHTML = "랭킹을 불러오는 중입니다.";
    rankUnsubscribe = onSnapshot(q, (snap) => {
      if(snap.empty){
        $("rankList").className = "empty";
        $("rankList").innerHTML = "아직 랭킹 데이터가 없습니다.";
        return;
      }

      $("rankList").className = "";
      let i = 0;
      $("rankList").innerHTML = snap.docs.map(d=>{
        i++;
        const u = d.data();
        return `
          <div class="rank-row ${i===1 ? "top" : ""}">
            <div class="rank-no">${i}</div>
            <div>
              <b>${u.nickname || "사용자"}</b>
              <p>${won(u.totalAsset || 0)}</p>
            </div>
          </div>
        `;
      }).join("");
    }, (e) => {
      console.error(e);
      $("rankList").className = "empty";
      $("rankList").innerHTML = "랭킹을 불러오지 못했습니다.";
    });
    return;

    const snap = await getDocs(q);
    if(snap.empty){
      $("rankList").className = "empty";
      $("rankList").innerHTML = "아직 랭킹 데이터가 없습니다.";
      return;
    }
    $("rankList").className = "";
    let i = 0;
    $("rankList").innerHTML = snap.docs.map(d=>{
      i++;
      const u = d.data();
      return `
        <div class="rank-row ${i===1 ? "top" : ""}">
          <div class="rank-no">${i}</div>
          <div>
            <b>${u.nickname || "투자자"}</b>
            <p>${won(u.totalAsset || 0)}</p>
          </div>
        </div>
      `;
    }).join("");
  }catch(e){
    $("rankList").className = "empty";
    $("rankList").innerHTML = "랭킹을 불러오지 못했습니다.";
  }
}

function renderProfile(){
  const name = state.user.nickname || "투자자";
  $("profileName").textContent = name;
  $("profileEmail").textContent = state.user.loginName ? "이름 로그인" : (state.email || state.user.email || "-");
  $("avatar").textContent = name.slice(0,2).toUpperCase();
  $("profileQuick").textContent = name.slice(0,2).toUpperCase();
  $("profileTotal").textContent = won(totalAsset());
  $("profileTrades").textContent = `${state.user.tradeCount || 0}회`;
  $("profileFavs").textContent = `${state.user.favorites?.length || 0}개`;
}

function renderAll(){
  renderHome();
  renderMarket();
  renderWallet();
  renderProfile();
}

$("refreshBtn").onclick = async () => {
  renderAll();
  try{
    await save(false);
  }catch(e){
    console.error(e);
  }
  toast("새로고침 완료");
};

setInterval(()=>{
  $("tickTimer").textContent = getNextTickText();
  if(state.screen === "rankScreen" && state.uid){
    const rankAssetSyncBucket = Math.floor(Date.now() / (5 * 60 * 1000));
    if(lastRankAssetSyncBucket !== rankAssetSyncBucket){
      lastRankAssetSyncBucket = rankAssetSyncBucket;
      save(false, false).catch(console.error);
    }
  }
  if(state.screen === "detailScreen" && state.currentStock){
    const id = state.currentStock.id;
    const base = STOCKS.find(x=>x.id===id);
    state.currentStock = getStockView(base, state.chartRange);
    $("detailPrice").textContent = won(state.currentStock.price);
    $("detailChange").textContent = `${state.currentStock.change >= 0 ? "▲" : "▼"} ${Math.abs(state.currentStock.change).toFixed(2)}%`;
    $("detailChange").className = state.currentStock.change >= 0 ? "up" : "down";
    drawChart(state.currentStock.chart);
  }
}, 1000);
