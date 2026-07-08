import { STOCKS } from "./data.js";

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

function getWindowStart(b){
  return b - 180;
}

export function getPriceAtBucket(stock, targetBucket){
  const startBucket = getWindowStart(targetBucket);
  let price = stock.start;
  const range = Math.max(1, stock.max - stock.min);
  const mid = (stock.max + stock.min) / 2;

  for(let b=startBucket; b<=targetBucket; b++){
    const position = (price - mid) / (range / 2);
    const wallBias = -position * (0.0022 + stock.vol * 0.00055);
    const noise = (random(hash(stock.id) + b * 139) - 0.5) * (0.006 + stock.vol * 0.0042);
    const wave = Math.sin((b + hash(stock.name) % 977) / (10 + stock.vol)) * (0.0009 * stock.vol);
    let next = price * (1 + wallBias + noise + wave);

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
  const cfgMap = {
    "5m": {points:12, step:1},
    "1h": {points:12, step:12},
    "1d": {points:24, step:288},
    "1w": {points:28, step:504},
    "all": {points:36, step:1008}
  };
  const cfg = cfgMap[range] || cfgMap["5m"];
  const now = bucket(0);
  const arr = [];
  for(let i=cfg.points-1;i>=0;i--){
    arr.push(getPriceAtBucket(stock, now - i * cfg.step));
  }
  return arr;
}

export function getStockView(stock, range="5m"){
  const price = getPrice(stock, 0);
  const prev = getPrice(stock, -1);
  const change = ((price - prev) / prev) * 100;
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
