import { STOCKS } from "./data.js";

export const LISTING_TIME_MS = new Date("2026-07-09T12:00:00+09:00").getTime();
export const LISTING_TEXT = "2026.07.09 12:00";

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

  let price = stock.start;
  const startBucket = Math.max(lb + 1, targetBucket - 180);
  const range = Math.max(1, stock.max - stock.min);
  const mid = (stock.max + stock.min) / 2;

  for(let b=startBucket; b<=targetBucket; b++){
    const position = (price - mid) / (range / 2);

    // 최대가 근처: 상승 약화 / 하락 강화
    // 최저가 근처: 하락 약화 / 상승 강화
    const wallBias = -position * (0.0022 + stock.vol * 0.00055);

    // 종목별 변동성만 다르게 적용
    const noise = (random(hash(stock.id) + b * 139) - 0.5) * (0.006 + stock.vol * 0.0042);
    const wave = Math.sin((b + hash(stock.name) % 977) / (10 + stock.vol)) * (0.0009 * stock.vol);

    let next = price * (1 + wallBias + noise + wave);

    // 벽에 닿으면 차트가 뚝 끊기지 않게 튕기는 느낌
    if(next > stock.max){
      next = stock.max - (next - stock.max) * 0.45;
    }
    if(next < stock.min){
      next = stock.min + (stock.min - next) * 0.45;
    }

    price = Math.max(stock.min, Math.min(stock.max, next));
  }

  return Math.max(1, Math.round(price));
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
