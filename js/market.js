import { STOCKS } from "./data.js";

export const LISTING_TIME_MS = new Date("2026-07-09T00:10:00+09:00").getTime();
export const LISTING_TEXT = "2026.07.09 00:10";
const CHART_HISTORY_KEY = "stocklife.chartHistory.v1";
const MAX_FILL_GAP = 360;
const MAX_HISTORY_BUCKETS_PER_STOCK = 30000;

let chartHistoryCache = null;

function hash(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h += (h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);
  }
  return Math.abs(h >>> 0);
}

function random(seed){
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function canUseLocalStorage(){
  try{
    return typeof localStorage !== "undefined";
  }catch{
    return false;
  }
}

function loadChartHistory(){
  if(chartHistoryCache) return chartHistoryCache;

  chartHistoryCache = {
    schema:1,
    listingText:LISTING_TEXT,
    listingTime:LISTING_TIME_MS,
    stocks:{}
  };

  if(!canUseLocalStorage()) return chartHistoryCache;

  try{
    const raw = localStorage.getItem(CHART_HISTORY_KEY);
    if(!raw) return chartHistoryCache;

    const parsed = JSON.parse(raw);
    if(parsed && typeof parsed === "object"){
      chartHistoryCache = {
        schema:1,
        listingText:LISTING_TEXT,
        listingTime:LISTING_TIME_MS,
        stocks: parsed.stocks && typeof parsed.stocks === "object" ? parsed.stocks : {}
      };
    }
  }catch(e){
    console.warn("차트 기록을 불러오지 못했습니다.", e);
  }

  return chartHistoryCache;
}

function saveChartHistory(){
  if(!canUseLocalStorage()) return;

  try{
    localStorage.setItem(CHART_HISTORY_KEY, JSON.stringify(loadChartHistory()));
  }catch(e){
    console.warn("차트 기록을 저장하지 못했습니다.", e);
  }
}

function getStockHistory(stockId){
  const history = loadChartHistory();
  history.stocks[stockId] ||= {};
  return history.stocks[stockId];
}

function trimStockHistory(history){
  const buckets = Object.keys(history).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  const overflow = buckets.length - MAX_HISTORY_BUCKETS_PER_STOCK;
  if(overflow <= 0) return;

  buckets.slice(0, overflow).forEach(b => delete history[b]);
}

export function bucket(offset=0){
  return Math.floor(Date.now() / (5 * 60 * 1000)) + offset;
}

function bucketFromMs(ms){
  return Math.floor(ms / (5 * 60 * 1000));
}

function msFromBucket(b){
  return b * 5 * 60 * 1000;
}

function listingBucket(){
  return bucketFromMs(LISTING_TIME_MS);
}

function clampPrice(stock, price){
  return Math.max(stock.min, Math.min(stock.max, price));
}

function calculateNextPrice(stock, targetBucket, previousPrice){
  const range = Math.max(1, stock.max - stock.min);
  const mid = (stock.max + stock.min) / 2;
  const position = (previousPrice - mid) / (range / 2);

  // 최대가 근처: 상승 약화 / 하락 강화
  // 최저가 근처: 하락 약화 / 상승 강화
  const wallBias = -position * (0.0022 + stock.vol * 0.00055);

  // 종목별 변동성만 다르게 적용
  const noise = (random(hash(stock.id) + targetBucket * 139) - 0.5) * (0.006 + stock.vol * 0.0042);
  const wave = Math.sin((targetBucket + hash(stock.name) % 977) / (10 + stock.vol)) * (0.0009 * stock.vol);

  let next = previousPrice * (1 + wallBias + noise + wave);

  // 벽에 닿으면 차트가 뚝 끊기지 않게 튕기는 느낌
  if(next > stock.max){
    next = stock.max - (next - stock.max) * 0.45;
  }
  if(next < stock.min){
    next = stock.min + (stock.min - next) * 0.45;
  }

  return Math.max(1, Math.round(clampPrice(stock, next)));
}

function calculateBasePriceAtBucket(stock, targetBucket){
  const lb = listingBucket();

  if(targetBucket <= lb){
    return Math.max(1, Math.round(stock.start));
  }

  let price = stock.start;
  const startBucket = Math.max(lb + 1, targetBucket - 180);

  for(let b=startBucket; b<=targetBucket; b++){
    price = calculateNextPrice(stock, b, price);
  }

  return Math.max(1, Math.round(price));
}

function formatDateTime(ms){
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  const h = String(d.getHours()).padStart(2,"0");
  const mi = String(d.getMinutes()).padStart(2,"0");
  return `${y}.${mo}.${da} ${h}:${mi}`;
}

function formatShort(ms){
  const d = new Date(ms);
  const mo = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  const h = String(d.getHours()).padStart(2,"0");
  const mi = String(d.getMinutes()).padStart(2,"0");
  return `${mo}.${da} ${h}:${mi}`;
}

export function getPriceAtBucket(stock, targetBucket){
  const lb = listingBucket();

  if(targetBucket <= lb){
    return Math.max(1, Math.round(stock.start));
  }

  const history = getStockHistory(stock.id);
  const stored = history[targetBucket];
  if(Number.isFinite(stored)) return stored;

  const buckets = Object.keys(history).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  const previousBucket = buckets.filter(b => b < targetBucket).pop();

  if(Number.isFinite(previousBucket) && targetBucket - previousBucket <= MAX_FILL_GAP){
    let price = Number(history[previousBucket]);
    for(let b=previousBucket + 1; b<=targetBucket; b++){
      price = calculateNextPrice(stock, b, price);
      history[b] = price;
    }
  }else{
    history[targetBucket] = calculateBasePriceAtBucket(stock, targetBucket);
  }

  trimStockHistory(history);
  saveChartHistory();
  return history[targetBucket];
}

export function getPrice(stock, offset=0){
  return getPriceAtBucket(stock, bucket(offset));
}

export function getChart(stock, range){
  const now = bucket(0);
  const lb = listingBucket();
  const safeNow = Math.max(now, lb);

  const cfgMap = {
    "5m": {points:12, step:1},
    "1h": {points:12, step:12},
    "1d": {points:24, step:288},
    "1w": {points:28, step:504}
  };

  let buckets = [];

  if(range === "all"){
    const span = Math.max(1, safeNow - lb);
    const points = 36;
    const step = Math.max(1, Math.floor(span / (points - 1)));
    for(let b=lb; b<=safeNow; b+=step){
      buckets.push(b);
    }
    if(buckets[buckets.length-1] !== safeNow) buckets.push(safeNow);
    buckets = buckets.slice(-36);
  }else{
    const cfg = cfgMap[range] || cfgMap["5m"];
    for(let i=cfg.points-1;i>=0;i--){
      const b = Math.max(lb, safeNow - i * cfg.step);
      if(!buckets.includes(b)) buckets.push(b);
    }
  }

  return buckets.map(b => {
    const ms = msFromBucket(b);
    return {
      bucket:b,
      time:ms,
      label:formatDateTime(ms),
      shortLabel:formatShort(ms),
      price:getPriceAtBucket(stock, b)
    };
  });
}

export function getStockView(stock, range="5m"){
  const price = getPrice(stock, 0);
  const prev = getPrice(stock, -1);
  const change = prev === 0 ? 0 : ((price - prev) / prev) * 100;
  const chart = getChart(stock, range);
  return {...stock, price, prev, change, chart};
}

export function getAllStockViews(range="5m"){
  return STOCKS.map(s => getStockView(s, range));
}

export function getNextTickText(){
  const ms = 5 * 60 * 1000;
  const remain = ms - (Date.now() % ms);
  const m = Math.floor(remain / 60000);
  const s = Math.floor((remain % 60000) / 1000);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
