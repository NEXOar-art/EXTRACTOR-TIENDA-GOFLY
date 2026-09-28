// GoFlyMX Catalog Extractor
// Node.js 18+
// Instalar: npm install
// Ejecutar: npm start
// Abrir: http://localhost:3000

const express = require("express");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname)));

const UA = "Mozilla/5.0 (compatible; GoFlyCatalogExtractor/1.0)";
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function abs(base, href){
  try{return new URL(href,base).href.split("#")[0]}catch{return null}
}
function sameOrigin(a,b){
  try{return new URL(a).origin===new URL(b).origin}catch{return false}
}
function clean(s){return (s||"").replace(/\s+/g," ").trim()}
function isProduct(u){return /\.html(?:\?|$)/i.test(new URL(u).pathname)}
function isNoise(u){
  const x=new URL(u);
  const p=x.pathname.toLowerCase();
  return /\/(cart|checkout|login|register|account|wishlist|search|contact|privacy|terms)\b/.test(p)
      || /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js|xml|json)$/i.test(p)
      || /^(mailto:|tel:|javascript:)/i.test(u);
}
function likelyCategory(u,origin){
  if(!sameOrigin(u,origin)||isNoise(u)||isProduct(u))return false;
  const p=new URL(u).pathname;
  return p!=="/" && p.length<180;
}

async function get(url, signal){
  const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},signal});
  if(!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.text();
}

function extractLinks(html,url,origin){
  const $=cheerio.load(html), out=new Set();
  $("a[href]").each((_,el)=>{
    const u=abs(url,$(el).attr("href"));
    if(u && sameOrigin(u,origin) && !isNoise(u)) out.add(u);
  });
  return [...out];
}

function categoryFrom($,url){
  const vals=[];
  // Breadcrumb-like structures.
  $('nav a, .breadcrumb a, [class*="breadcrumb"] a, .category-breadcrumb a').each((_,e)=>{
    const t=clean($(e).text()); if(t && !/^inicio$/i.test(t)) vals.push(t);
  });
  if(vals.length) return [...new Set(vals)].slice(-3).join(" > ");
  // URL fallback.
  const parts=new URL(url).pathname.split("/").filter(Boolean).filter(x=>!x.endsWith(".html"));
  return parts.map(x=>decodeURIComponent(x).replace(/[-_]+/g," ")).join(" > ");
}

function productFrom($,url){
  const sels=[
    "h1.product-name","h1[itemprop='name']","h1.page-title","h1",
    ".product-title",".product-name",".name"
  ];
  for(const s of sels){const t=clean($(s).first().text());if(t && t.length>2)return t}
  const og=clean($('meta[property="og:title"]').attr("content"));
  if(og)return og;
  return decodeURIComponent(new URL(url).pathname.split("/").pop().replace(/\.html$/i,"")).replace(/[-_]+/g," ");
}

function descriptionFrom($){
  const sels=[
    '[itemprop="description"]','.product-description','.description',
    '#description','.tab-description','.product-info-description',
    '.product-detail-description','.long-description'
  ];
  for(const s of sels){
    const e=$(s).first();
    if(e.length){const t=clean(e.text());if(t && t.length>20)return t}
  }
  const meta=clean($('meta[name="description"]').attr("content"));
  return meta || "";
}

function stockFrom($){
  const candidates=[
    '[itemprop="availability"]','.stock','.product-stock',
    '.availability','.stock-status','.availability-status',
    '.product-availability','.inventory'
  ];
  for(const s of candidates){
    const e=$(s).first();
    if(e.length){
      const t=clean(e.attr("content")||e.text());
      if(t)return t;
    }
  }
  const body=clean($("body").text());
  const patterns=[
    /(?:stock|disponibilidad|disponible|existencia|existencias)[\s:–-]{0,8}([^\n]{0,80})/i,
    /(sin stock|agotado|no disponible|fuera de stock)/i,
    /(stock disponible|disponible para compra)/i
  ];
  for(const re of patterns){const m=body.match(re);if(m)return clean(m[0])}
  return "No detectado";
}

function extractProductsFromPage(html,url){
  const $=cheerio.load(html), found=[];
  $("a[href]").each((_,a)=>{
    const href=abs(url,$(a).attr("href"));
    if(!href||!isProduct(href))return;
    const title=clean($(a).text());
    if(title.length<3)return;
    found.push(href);
  });
  return [...new Set(found)];
}

app.post("/api/start", async (req,res)=>{
  const origin=String(req.body.origin||"https://tienda.goflymx.com/").trim().replace(/\/+$/,"");
  const maxPages=Math.min(Math.max(Number(req.body.maxPages)||1000,10),10000);
  const concurrency=Math.min(Math.max(Number(req.body.concurrency)||3,1),8);
  let aborted=false;
  req.on("close",()=>{aborted=true});

  res.setHeader("Content-Type","application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control","no-cache");
  res.setHeader("Connection","keep-alive");

  const send=o=>{if(!aborted){res.write(JSON.stringify(o)+"\n")}};

  try{
    const home=await get(origin+"/");
    const queue=[origin+"/"];
    const seen=new Set();
    const products=new Set();
    const productContext=new Map();
    let pages=0, errors=0;

    while(queue.length && pages<maxPages && !aborted){
      const batch=[];
      while(queue.length && batch.length<concurrency && pages+batch.length<maxPages){
        const u=queue.shift();
        if(!u||seen.has(u))continue;
        seen.add(u);batch.push(u);
      }
      if(!batch.length)break;

      const results=await Promise.all(batch.map(async u=>{
        try{return {u,html:await get(u)}}
        catch(e){return {u,error:e.message}}
      }));

      for(const r of results){
        pages++;
        if(r.error){errors++;send({type:"progress",pages,errors,message:`Error en página: ${r.u}`});continue}
        const $=cheerio.load(r.html);
        const cat=categoryFrom($,r.u);
        const ps=extractProductsFromPage(r.html,r.u);
        for(const p of ps){products.add(p);if(!productContext.has(p))productContext.set(p,cat)}
        for(const l of extractLinks(r.html,r.u,origin)){
          if(likelyCategory(l,origin) && !seen.has(l) && queue.length+seen.size<maxPages*2)queue.push(l);
        }
        send({type:"progress",pages,errors,message:`Descubiertas ${products.size} fichas · cola ${queue.length}`,total:Math.max(pages+queue.length,1)});
      }
      await sleep(250);
    }

    send({type:"progress",pages,errors,message:`Fase de categorías terminada. Fichas encontradas: ${products.size}`});

    const list=[...products], total=list.length;
    let done=0;
    for(let i=0;i<list.length && !aborted;i+=concurrency){
      const batch=list.slice(i,i+concurrency);
      const rs=await Promise.all(batch.map(async url=>{
        try{return {url,html:await get(url)}}
        catch(e){return {url,error:e.message}}
      }));
      for(const r of rs){
        done++;
        if(r.error){errors++;send({type:"progress",pages,errors,message:`Error de producto ${done}/${total}`});continue}
        const $=cheerio.load(r.html);
        const data={
          tipo: productContext.get(r.url)||categoryFrom($,r.url)||"No detectado",
          producto: productFrom($,r.url),
          stock: stockFrom($),
          descripcion: descriptionFrom($)
        };
        if(data.producto && data.producto.length>2){
          send({type:"product",data});
        }
        send({type:"progress",pages,errors,message:`Leyendo productos ${done}/${total}`,total});
      }
      await sleep(250);
    }

    send({type:"done",message:`Finalizado. Se procesaron ${done} fichas. Errores: ${errors}.`});
  }catch(e){
    send({type:"error",message:e.message});
  }finally{
    res.end();
  }
});

app.listen(3000,()=>console.log("Extractor GoFlyMX: http://localhost:3000"));
