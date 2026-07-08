import { auth, db } from "./firebase.js";
import { getAllStockViews, getNextTickText } from "./market.js";
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
  updateDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const state = {
  uid:null,
  email:"",
  user:{
    nickname:"투자자",
    cash:1000000,
    holdings:{},
    favorites:[],
    tradeCount:0,
    history:[],
    totalAsset:1000000
  },
  screen:"authScreen",
  filter:"all",
  currentStock:null,
  tradeType:"buy",
  qty:1,
  sort:"name"
};

const titles = {
  homeScreen:"홈",
  marketScreen:"시장",
  detailScreen:"종목",
  walletScreen:"지갑",
  rankScreen:"랭킹",
  profileScreen:"프로필"
};

function won(v){ return Math.round(v).toLocaleString("ko-KR") + "원"; }
function signWon(v){ return (v > 0 ? "+" : "") + won(v); }
function cls(v){ return v > 0 ? "up" : v < 0 ? "down" : "flat"; }

function toast(msg){
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(()=>$("toast").classList.remove("show"), 1700);
}

function holding(id){
  return state.user.holdings?.[id] || {shares:0, avg:0};
}

function stockValue(){
  return getAllStockViews().reduce((sum,s)=>sum + holding(s.id).shares * s.price, 0);
}

function totalAsset(){
  return state.user.cash + stockValue();
}

function todayProfit(){
  return getAllStockViews().reduce((sum,s)=>sum + (s.price - s.prev) * holding(s.id).shares, 0);
}

function show(screen){
  state.screen = screen;
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

$("showSignup").onclick = () => {
  $("loginBox").classList.add("hidden");
  $("signupBox").classList.remove("hidden");
};
$("showLogin").onclick = () => {
  $("signupBox").classList.add("hidden");
  $("loginBox").classList.remove("hidden");
};

$("signupBtn").onclick = async () => {
  const nickname = $("signupNickname").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value.trim();

  if(!nickname || !email || password.length < 6){
    toast("닉네임, 이메일, 비밀번호 6자 이상 입력");
    return;
  }

  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const data = {
      nickname,
      email,
      cash:1000000,
      holdings:{},
      favorites:[],
      tradeCount:0,
      history:[],
      totalAsset:1000000,
      createdAt:new Date().toISOString(),
      updatedAt:serverTimestamp()
    };
    await setDoc(doc(db, "users", cred.user.uid), data);
    toast("회원가입 완료");
  }catch(e){
    toast(errorMessage(e));
  }
};

$("loginBtn").onclick = async () => {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value.trim();
  if(!email || !password){
    toast("이메일과 비밀번호 입력");
    return;
  }

  try{
    await signInWithEmailAndPassword(auth, email, password);
  }catch(e){
    toast(errorMessage(e));
  }
};

$("logoutBtn").onclick = async () => {
  await signOut(auth);
  show("authScreen");
};

onAuthStateChanged(auth, async (user) => {
  if(!user){
    state.uid = null;
    return;
  }

  state.uid = user.uid;
  state.email = user.email || "";

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if(snap.exists()){
    state.user = {...state.user, ...snap.data()};
  }else{
    state.user = {
      nickname: user.email?.split("@")[0] || "투자자",
      email: user.email || "",
      cash:1000000,
      holdings:{},
      favorites:[],
      tradeCount:0,
      history:[],
      totalAsset:1000000,
      createdAt:new Date().toISOString(),
      updatedAt:serverTimestamp()
    };
    await setDoc(ref, state.user);
  }

  await save(false);
  renderAll();
  show("homeScreen");
});

function errorMessage(e){
  const c = e?.code || "";
  if(c.includes("email-already-in-use")) return "이미 사용 중인 이메일";
  if(c.includes("invalid-email")) return "이메일 형식 오류";
  if(c.includes("weak-password")) return "비밀번호가 너무 짧음";
  if(c.includes("invalid-credential")) return "로그인 정보가 틀림";
  if(c.includes("permission-denied")) return "Firestore 권한 설정 필요";
  return "오류: " + c;
}

async function save(showToast=false){
  if(!state.uid) return;
  state.user.totalAsset = totalAsset();
  state.user.updatedAt = serverTimestamp();
  await updateDoc(doc(db, "users", state.uid), state.user);
  if(showToast) toast("저장 완료");
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

function renderHome(){
  const total = totalAsset();
  const sv = stockValue();
  const tp = todayProfit();

  $("totalAsset").textContent = won(total);
  $("cashValue").textContent = won(state.user.cash);
  $("stockValue").textContent = won(sv);
  $("assetDelta").textContent = signWon(tp);
  $("assetDelta").className = cls(tp);

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

  $("marketList").innerHTML = list.map(stockRow).join("") || `<div class="empty">표시할 종목이 없습니다.</div>`;
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
  const s = getAllStockViews().find(x=>x.id === id);
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
  $("detailProfit").textContent = h.shares ? signWon(profit) : "-";
  $("detailProfit").className = cls(profit);

  const fav = state.user.favorites?.includes(s.id);
  $("favoriteBtn").textContent = fav ? "★" : "☆";
  $("favoriteBtn").classList.toggle("on", fav);

  drawChart(s.chart);
  show("detailScreen");
}

$("favoriteBtn").onclick = async () => {
  const id = state.currentStock?.id;
  if(!id) return;
  state.user.favorites ||= [];
  if(state.user.favorites.includes(id)){
    state.user.favorites = state.user.favorites.filter(x=>x!==id);
  }else{
    state.user.favorites.push(id);
  }
  await save(false);
  openStock(id);
  renderHome();
};

function drawChart(values){
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((v,i)=>{
    const x = (i/(values.length-1))*340;
    const y = 170 - ((v-min)/range)*140;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  $("chartLine").setAttribute("points", points);
  $("chartFill").setAttribute("points", `${points} 340,190 0,190`);
}

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
  $("qtyText").textContent = `${state.qty}주`;
  $("modalTotal").textContent = `총 ${won(state.currentStock.price * state.qty)}`;
}
$("qtyMinus").onclick = () => { state.qty = Math.max(1, state.qty-1); updateModal(); };
$("qtyPlus").onclick = () => { state.qty += 1; updateModal(); };
$("closeModal").onclick = () => $("tradeModal").classList.remove("show");

$("confirmTrade").onclick = async () => {
  const s = state.currentStock;
  const price = s.price;
  const amount = price * state.qty;
  const h = holding(s.id);

  if(state.tradeType === "buy"){
    if(state.user.cash < amount) return toast("보유 현금이 부족합니다.");
    const newShares = h.shares + state.qty;
    const newAvg = ((h.avg*h.shares) + amount) / newShares;
    state.user.cash -= amount;
    state.user.holdings[s.id] = {shares:newShares, avg:newAvg};
    addHistory("매수", s.name, state.qty, amount);
  }else{
    if(h.shares < state.qty) return toast("보유 수량이 부족합니다.");
    state.user.cash += amount;
    const remain = h.shares - state.qty;
    if(remain <= 0) delete state.user.holdings[s.id];
    else state.user.holdings[s.id] = {shares:remain, avg:h.avg};
    addHistory("매도", s.name, state.qty, amount);
  }

  state.user.tradeCount = (state.user.tradeCount || 0) + 1;
  $("tradeModal").classList.remove("show");
  await save(false);
  toast("거래 완료");
  openStock(s.id);
  renderAll();
};

function addHistory(type, name, qty, amount){
  state.user.history ||= [];
  state.user.history.unshift({
    type, name, qty, amount,
    time:new Date().toLocaleString("ko-KR", {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"})
  });
  state.user.history = state.user.history.slice(0,10);
}

function renderWallet(){
  $("walletTotal").textContent = won(totalAsset());
  $("walletCash").textContent = won(state.user.cash);
  $("walletStocks").textContent = won(stockValue());

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
      return `
        <div class="stock-row" data-stock="${s.id}">
          <div>
            <b>${s.name}</b>
            <p>${h.shares}주 · 평균 ${won(h.avg)}</p>
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

async function renderRank(){
  try{
    const q = query(collection(db, "users"), orderBy("totalAsset", "desc"), limit(20));
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
  $("profileEmail").textContent = state.email || state.user.email || "-";
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

$("refreshBtn").onclick = () => {
  renderAll();
  toast("새로고침 완료");
};

setInterval(()=>{
  $("tickTimer").textContent = getNextTickText();
  $("detailTimer").textContent = getNextTickText();
  // 상세 화면에서만 차트/가격 갱신. 다른 화면을 상세로 강제 이동시키지 않음.
  if(state.screen === "detailScreen" && state.currentStock){
    const id = state.currentStock.id;
    const s = getAllStockViews().find(x=>x.id===id);
    state.currentStock = s;
    $("detailPrice").textContent = won(s.price);
    $("detailChange").textContent = `${s.change >= 0 ? "▲" : "▼"} ${Math.abs(s.change).toFixed(2)}%`;
    $("detailChange").className = s.change >= 0 ? "up" : "down";
    drawChart(s.chart);
  }
}, 1000);
