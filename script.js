import { auth, db } from "./firebase.js";
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

const stocks = [
  {id:"hansung", name:"한성전자", start:95000, min:20000, max:5000000, vol:5},
  {id:"miraeEnergy", name:"미래에너지", start:3200, min:300, max:35000, vol:2},
  {id:"taesung", name:"태성자동차", start:680000, min:100000, max:2000000, vol:3},
  {id:"cheongun", name:"청운제약", start:450, min:50, max:120000, vol:5},
  {id:"daehanShip", name:"대한조선", start:220000, min:80000, max:800000, vol:2},
  {id:"goldSemi", name:"금성반도체", start:28000, min:5000, max:3500000, vol:4},
  {id:"neoGames", name:"네오게임즈", start:700, min:100, max:500000, vol:5},
  {id:"auroraAi", name:"오로라AI", start:55000, min:3000, max:5000000, vol:5},
  {id:"baekho", name:"백호건설", start:380000, min:150000, max:700000, vol:1},
  {id:"greenFood", name:"푸른식품", start:8500, min:2000, max:90000, vol:1},
  {id:"haesung", name:"해성해운", start:95000, min:10000, max:1300000, vol:3},
  {id:"miraeBio", name:"미래바이오", start:1800, min:100, max:4800000, vol:5},
  {id:"sungjin", name:"성진철강", start:1450000, min:400000, max:2500000, vol:2},
  {id:"koreaRobot", name:"한국로보틱스", start:16000, min:500, max:3800000, vol:4},
  {id:"starEnt", name:"스타엔터", start:12000, min:1000, max:600000, vol:3},
  {id:"aceFinance", name:"에이스금융", start:1900000, min:800000, max:2800000, vol:1},
  {id:"hanbitCloud", name:"한빛클라우드", start:42000, min:3000, max:2800000, vol:4},
  {id:"dreamMobility", name:"드림모빌리티", start:75000, min:5000, max:1500000, vol:3},
  {id:"nextSpace", name:"넥스트우주", start:950, min:100, max:5000000, vol:5},
  {id:"zenith", name:"제니스홀딩스", start:1800000, min:1000000, max:3000000, vol:2}
];

const app = {
  uid:null,
  email:"",
  user:{
    nickname:"투자자",
    cash:1000000,
    holdings:{},
    favorites:[],
    tradeCount:0,
    totalAsset:1000000
  },
  currentScreen:"authScreen",
  currentStock:null,
  filter:"all",
  qty:1,
  tradeType:"buy"
};

const $ = (id) => document.getElementById(id);

function formatWon(n){ return Math.round(n).toLocaleString("ko-KR") + "원"; }
function toast(msg){
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(()=>$("toast").classList.remove("show"), 1800);
}

function hash(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h += (h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);
  }
  return Math.abs(h >>> 0);
}
function rng(seed){
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
function bucketNow(offset=0){
  return Math.floor(Date.now() / (5 * 60 * 1000)) + offset;
}
function stockPrice(stock, offset=0){
  const b = bucketNow(offset);
  const seed = hash(stock.id) + b * 97;
  const center = stock.start * (1 + Math.sin((b + hash(stock.id)%300) / 38) * 0.18);
  const wave = Math.sin((b + hash(stock.name)%500) / (10 + stock.vol * 2)) * stock.start * (0.04 * stock.vol);
  const random = (rng(seed) - 0.5) * stock.start * (0.03 * stock.vol);
  let price = center + wave + random;
  price = Math.max(stock.min, Math.min(stock.max, price));
  return Math.max(1, Math.round(price));
}
function stockView(stock){
  const now = stockPrice(stock, 0);
  const prev = stockPrice(stock, -1);
  const change = ((now - prev) / prev) * 100;
  const chart = [];
  for(let i=-11;i<=0;i++) chart.push(stockPrice(stock, i));
  return {...stock, price:now, prev, change, chart};
}
function allViews(){ return stocks.map(stockView); }

function holding(stockId){
  return app.user.holdings?.[stockId] || {shares:0, avg:0};
}
function stockValue(){
  return allViews().reduce((sum,s)=> sum + holding(s.id).shares * s.price, 0);
}
function totalAsset(){
  return app.user.cash + stockValue();
}
function todayProfit(){
  return allViews().reduce((sum,s)=> {
    const h = holding(s.id);
    return sum + (s.price - s.prev) * h.shares;
  }, 0);
}
function signedClass(n){ return n > 0 ? "up" : n < 0 ? "down" : "flat"; }
function signedText(n){ return (n > 0 ? "+" : "") + formatWon(n); }

function showScreen(id){
  app.currentScreen = id;
  document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active", s.id===id));

  const inApp = id !== "authScreen";
  $("topbar").classList.toggle("hidden", !inApp);
  $("bottomNav").classList.toggle("hidden", !inApp);

  const titles = {homeScreen:"홈", marketScreen:"시장", detailScreen:"종목", walletScreen:"지갑", rankScreen:"랭킹", profileScreen:"프로필"};
  $("pageTitle").textContent = titles[id] || "홈";

  document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("active", n.dataset.go === id));

  if(id==="homeScreen") renderHome();
  if(id==="marketScreen") renderMarket();
  if(id==="walletScreen") renderWallet();
  if(id==="rankScreen") renderRanking();
  if(id==="profileScreen") renderProfile();
}
document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>showScreen(btn.dataset.go)));

$("showSignupBtn").onclick = () => {
  $("loginBox").classList.add("hidden");
  $("signupBox").classList.remove("hidden");
};
$("showLoginBtn").onclick = () => {
  $("signupBox").classList.add("hidden");
  $("loginBox").classList.remove("hidden");
};

$("signupBtn").onclick = async () => {
  const nickname = $("signupNickname").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value.trim();
  if(!nickname || !email || password.length < 6) return toast("닉네임, 이메일, 비밀번호 6자 이상 입력");

  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const userData = {
      nickname,
      email,
      cash:1000000,
      holdings:{},
      favorites:[],
      tradeCount:0,
      totalAsset:1000000,
      createdAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    };
    await setDoc(doc(db, "users", cred.user.uid), userData);
    toast("회원가입 완료");
  }catch(e){
    toast(firebaseError(e));
  }
};

$("loginBtn").onclick = async () => {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value.trim();
  if(!email || !password) return toast("이메일과 비밀번호를 입력");
  try{
    await signInWithEmailAndPassword(auth, email, password);
  }catch(e){
    toast(firebaseError(e));
  }
};

$("logoutBtn").onclick = async () => {
  await signOut(auth);
  showScreen("authScreen");
};

onAuthStateChanged(auth, async (user) => {
  if(!user){
    app.uid = null;
    return;
  }

  app.uid = user.uid;
  app.email = user.email || "";

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if(snap.exists()){
    app.user = {...app.user, ...snap.data()};
  }else{
    app.user = {
      nickname:user.email?.split("@")[0] || "투자자",
      email:user.email || "",
      cash:1000000,
      holdings:{},
      favorites:[],
      tradeCount:0,
      totalAsset:1000000
    };
    await setDoc(ref, {...app.user, createdAt:serverTimestamp(), updatedAt:serverTimestamp()});
  }

  await saveUser(false);
  showScreen("homeScreen");
  renderAll();
});

function firebaseError(e){
  const code = e?.code || "";
  if(code.includes("email-already-in-use")) return "이미 사용 중인 이메일";
  if(code.includes("invalid-email")) return "이메일 형식이 이상함";
  if(code.includes("weak-password")) return "비밀번호가 너무 짧음";
  if(code.includes("wrong-password") || code.includes("invalid-credential")) return "로그인 정보가 틀림";
  return "오류: " + code;
}

async function saveUser(show=true){
  if(!app.uid) return;
  app.user.totalAsset = totalAsset();
  app.user.updatedAt = serverTimestamp();
  await updateDoc(doc(db, "users", app.uid), app.user);
  if(show) toast("저장 완료");
}

function rowHtml(s){
  const h = holding(s.id);
  const cls = s.change >= 0 ? "up" : "down";
  const arrow = s.change >= 0 ? "▲" : "▼";
  return `
    <div class="stock-row" data-stock="${s.id}">
      <div>
        <b>${h.shares ? "💼 " : ""}${s.name}</b>
        <p>${formatWon(s.price)}${h.shares ? ` · 보유 ${h.shares}주` : ""}</p>
      </div>
      <strong class="${cls}">${arrow} ${Math.abs(s.change).toFixed(2)}%</strong>
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
  const today = todayProfit();
  $("totalAsset").textContent = formatWon(total);
  $("cashValue").textContent = formatWon(app.user.cash);
  $("todayProfit").textContent = signedText(today);
  $("todayProfit").className = signedClass(today);

  const favs = allViews().filter(s=>app.user.favorites?.includes(s.id));
  if(!favs.length){
    $("favoriteList").className = "empty-box";
    $("favoriteList").innerHTML = "관심 종목이 없습니다.";
  }else{
    $("favoriteList").className = "";
    $("favoriteList").innerHTML = favs.map(rowHtml).join("");
    bindRows($("favoriteList"));
  }
}
function renderMarket(){
  const key = $("searchInput").value.trim();
  let arr = allViews().filter(s=>!key || s.name.includes(key));
  if(app.filter==="up") arr = arr.filter(s=>s.change >= 0);
  if(app.filter==="down") arr = arr.filter(s=>s.change < 0);
  if(app.filter==="hold") arr = arr.filter(s=>holding(s.id).shares > 0);

  $("marketList").innerHTML = arr.map(rowHtml).join("") || `<div class="empty-box">표시할 종목이 없습니다.</div>`;
  bindRows($("marketList"));
}
$("searchInput").oninput = renderMarket;
document.querySelectorAll(".chip-tabs button").forEach(btn=>{
  btn.onclick = () => {
    document.querySelectorAll(".chip-tabs button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    app.filter = btn.dataset.filter;
    renderMarket();
  };
});

function openStock(id){
  const s = allViews().find(x=>x.id===id);
  app.currentStock = s;
  $("detailName").textContent = s.name;
  $("detailPrice").textContent = formatWon(s.price);
  $("detailChange").textContent = `${s.change >= 0 ? "▲" : "▼"} ${Math.abs(s.change).toFixed(2)}%`;
  $("detailChange").className = s.change >= 0 ? "up" : "down";

  const h = holding(s.id);
  $("detailShares").textContent = `${h.shares}주`;
  $("detailAvg").textContent = h.shares ? formatWon(h.avg) : "-";
  const pnl = (s.price - h.avg) * h.shares;
  $("detailPnL").textContent = h.shares ? signedText(pnl) : "-";
  $("detailPnL").className = signedClass(pnl);

  const fav = app.user.favorites?.includes(s.id);
  $("starBtn").textContent = fav ? "★" : "☆";
  $("starBtn").classList.toggle("on", fav);

  drawChart(s.chart);
  showScreen("detailScreen");
}
$("starBtn").onclick = async () => {
  const id = app.currentStock.id;
  app.user.favorites ||= [];
  if(app.user.favorites.includes(id)){
    app.user.favorites = app.user.favorites.filter(x=>x!==id);
  }else{
    app.user.favorites.push(id);
  }
  await saveUser(false);
  openStock(id);
};

function drawChart(values){
  const min = Math.min(...values), max = Math.max(...values), range = Math.max(1, max-min);
  const points = values.map((v,i)=>{
    const x = (i/(values.length-1))*320;
    const y = 145 - ((v-min)/range)*120;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  $("chartLine").setAttribute("points", points);
  $("chartFill").setAttribute("points", `${points} 320,170 0,170`);
}

document.querySelectorAll("[data-trade]").forEach(btn=>{
  btn.onclick = () => {
    app.tradeType = btn.dataset.trade;
    app.qty = 1;
    openTrade();
  };
});
function openTrade(){
  const s = app.currentStock;
  $("tradeTitle").textContent = app.tradeType === "buy" ? "매수" : "매도";
  $("tradeSub").textContent = `${s.name} · ${formatWon(s.price)}`;
  $("tradeModal").classList.add("show");
  updateTrade();
}
function updateTrade(){
  $("qtyText").textContent = `${app.qty}주`;
  $("tradeTotal").textContent = `총 ${formatWon(app.currentStock.price * app.qty)}`;
}
$("minusQty").onclick = () => { app.qty = Math.max(1, app.qty-1); updateTrade(); };
$("plusQty").onclick = () => { app.qty++; updateTrade(); };
$("closeTrade").onclick = () => $("tradeModal").classList.remove("show");

$("confirmTrade").onclick = async () => {
  const s = app.currentStock;
  const cost = s.price * app.qty;
  const h = holding(s.id);

  if(app.tradeType === "buy"){
    if(app.user.cash < cost) return toast("보유 현금이 부족합니다.");
    const newShares = h.shares + app.qty;
    const newAvg = ((h.avg*h.shares) + cost) / newShares;
    app.user.cash -= cost;
    app.user.holdings[s.id] = {shares:newShares, avg:newAvg};
    app.user.tradeCount = (app.user.tradeCount || 0) + 1;
  }else{
    if(h.shares < app.qty) return toast("보유 수량이 부족합니다.");
    app.user.cash += cost;
    const remain = h.shares - app.qty;
    if(remain <= 0) delete app.user.holdings[s.id];
    else app.user.holdings[s.id] = {shares:remain, avg:h.avg};
    app.user.tradeCount = (app.user.tradeCount || 0) + 1;
  }

  $("tradeModal").classList.remove("show");
  await saveUser(false);
  openStock(s.id);
  renderAll();
  toast("거래 완료");
};

function renderWallet(){
  $("walletTotal").textContent = formatWon(totalAsset());
  $("walletCash").textContent = formatWon(app.user.cash);
  $("walletStockValue").textContent = formatWon(stockValue());

  const held = allViews().filter(s=>holding(s.id).shares>0);
  $("holdingCount").textContent = `${held.length}개`;
  if(!held.length){
    $("holdingList").className = "empty-box";
    $("holdingList").innerHTML = "보유 종목이 없습니다.";
  }else{
    $("holdingList").className = "";
    $("holdingList").innerHTML = held.map(s=>{
      const h = holding(s.id);
      const pnl = (s.price - h.avg) * h.shares;
      return `
        <div class="stock-row" data-stock="${s.id}">
          <div>
            <b>${s.name}</b>
            <p>${h.shares}주 · 평균 ${formatWon(h.avg)}</p>
          </div>
          <strong class="${signedClass(pnl)}">${signedText(pnl)}</strong>
        </div>
      `;
    }).join("");
    bindRows($("holdingList"));
  }
}

async function renderRanking(){
  try{
    const q = query(collection(db, "users"), orderBy("totalAsset", "desc"), limit(20));
    const snap = await getDocs(q);
    if(snap.empty){
      $("rankingList").className = "empty-box";
      $("rankingList").innerHTML = "아직 랭킹 데이터가 없습니다.";
      return;
    }
    $("rankingList").className = "";
    let i = 0;
    $("rankingList").innerHTML = snap.docs.map(d=>{
      i++;
      const u = d.data();
      return `
        <div class="rank-row ${i===1?"top":""}">
          <div class="rank-num">${i}</div>
          <div>
            <b>${u.nickname || "투자자"}</b>
            <p>${formatWon(u.totalAsset || 0)}</p>
          </div>
        </div>
      `;
    }).join("");
  }catch(e){
    $("rankingList").className = "empty-box";
    $("rankingList").innerHTML = "랭킹을 불러오려면 Firestore 인덱스/권한 설정이 필요할 수 있습니다.";
  }
}

function renderProfile(){
  const name = app.user.nickname || "투자자";
  $("profileName").textContent = name;
  $("profileEmail").textContent = app.email || app.user.email || "-";
  $("avatar").textContent = name.slice(0,2).toUpperCase();
  $("profileButton").textContent = name.slice(0,2).toUpperCase();
  $("tradeCount").textContent = `${app.user.tradeCount || 0}회`;
  $("favCount").textContent = `${app.user.favorites?.length || 0}개`;
}

function renderAll(){
  renderHome();
  renderMarket();
  renderWallet();
  renderProfile();
}

setInterval(()=>{
  $("nextTick").textContent = nextTickText();
  if(app.currentScreen !== "authScreen"){
    renderAll();
    if(app.currentStock) openStock(app.currentStock.id);
  }
}, 1000);

function nextTickText(){
  const ms = 5*60*1000;
  const remain = ms - (Date.now() % ms);
  const m = Math.floor(remain/60000);
  const s = Math.floor((remain%60000)/1000);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
