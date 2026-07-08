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

export function getPrice(stock, offset=0){
  const b = bucket(offset);
  const h = hash(stock.id);
  const drift = Math.sin((b + h % 997) / (34 + stock.vol)) * stock.start * (0.035 * stock.vol);
  const cycle = Math.sin((b + h % 331) / (9 + stock.vol)) * stock.start * (0.018 * stock.vol);
  const noise = (random(h + b * 131) - 0.5) * stock.start * (0.026 * stock.vol);
  let price = stock.start + drift + cycle + noise;
  price = Math.max(stock.min, Math.min(stock.max, price));
  return Math.max(1, Math.round(price));
}

export function getStockView(stock){
  const price = getPrice(stock, 0);
  const prev = getPrice(stock, -1);
  const change = ((price - prev) / prev) * 100;
  const chart = [];
  for(let i=-15;i<=0;i++) chart.push(getPrice(stock, i));
  return {...stock, price, prev, change, chart};
}

export function getAllStockViews(){
  return STOCKS.map(getStockView);
}

export function getNextTickText(){
  const ms = 5 * 60 * 1000;
  const remain = ms - (Date.now() % ms);
  const m = Math.floor(remain / 60000);
  const s = Math.floor((remain % 60000) / 1000);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
