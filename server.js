const express=require("express");
const cheerio=require("cheerio");
const path=require("path");

const app=express();
const PORT=3000;
const DEFAULT_ORIGIN="https://tienda.goflymx.com";
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname)));

const clean=s=>(s||"").replace(/\s+/g," ").trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function absolute(base,href){
  try{return new URL(href,base).href.split("#")[0]}catch{return null}
}
function sameOrigin(a,b){
  try{return new URL(a).origin===new URL(b).origin}catch{return false}
}
function validUrl(u,origin){
  try{
    const x=new URL(u);
    if(x.origin!==origin)return false;
    const p=x.pathname.toLowerCase();
    if(/\.(jpg|jpeg|png|gif|webp|svg|css|js|pdf|zip|mp4|ico)$/i.test(p))return false;
    if(/\/(shopping_cart|checkout|login|register|account|wishlist|search|contact|privacy|terms)\b/i.test(p))return false;
    return true;
  }catch{return false}
}
function isProductUrl(u){
  try{return /\.html$/i.test(new URL(u).pathname)}catch{return false}
}

async function fetchHtml(url,signal){
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),15000);
  if(signal) signal.addEventListener("abort",()=>ctl.abort(),{once:true});
  try{
    const r=await fetch(url,{
      signal:ctl.signal,
      redirect:"follow",
      headers:{
        "User-Agent":"Mozilla/5.0 (compatible; GoFlyMX-Stock-Checker/3.0)",
        "Accept":"text/html,application/xhtml+xml"
      }
    });
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.text();
  }finally{clearTimeout(timer)}
}

/*
  IMPORTANTE:
  La web pública de GoFlyMX muestra "Código XXXX" y, cuando no hay stock,
  un botón "Sin stock". También puede mostrar "STOCK DISPONIBLE".
  No se interpreta Min. Vta. / Max Vta. como inventario.
*/
function extractCode($){
  const selectors=[
    '[itemprop="sku"]',
    '.sku',
    '.product-sku',
    '.product-code',
    '.reference',
    '[class*="sku"]'
  ];
  for(const s of selectors){
    const e=$(s).first();
    if(e.length){
      const v=clean(e.attr("content")||e.attr("data-sku")||e.text());
      if(v)return v;
    }
  }

  const text=clean($("body").text());
  const m=text.match(/(?:C[oó]digo|SKU|Referencia)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/#-]{1,80})/i);
  return m?clean(m[1]):"";
}

function extractStock($){
  const text=clean($("body").text());

  // Estado explícito de GoFlyMX.
  if(/\bSIN\s+STOCK\b/i.test(text) ||
     /\bPRODUCTO\s+NO\s+DISPONIBLE\b/i.test(text) ||
     /\bNO\s+DISPONIBLE\b/i.test(text)){
    return {value:1,label:"1 (SIN STOCK)",sinStock:true};
  }

  // Si alguna versión de la página expone una cantidad real de stock.
  const selectors=[
    '[data-stock]','[data-inventory]',
    '[itemprop="inventoryLevel"]',
    '.stock-quantity','.inventory-quantity',
    '.product-stock-quantity'
  ];

  for(const s of selectors){
    const e=$(s).first();
    if(!e.length)continue;
    const raw=clean(e.attr("data-stock")||e.attr("data-inventory")||e.attr("content")||e.text());
    const m=raw.match(/(?:^|\D)(\d+)(?:\D|$)/);
    if(m){
      const n=Number(m[1]);
      return {value:n,label:String(n),sinStock:n===0};
    }
  }

  return {value:null,label:"NO DETECTADO",sinStock:false};
}

function linksFrom(html,url,origin){
  const $=cheerio.load(html), out=new Set();
  $("a[href]").each((_,a)=>{
    const u=absolute(url,$(a).attr("href"));
    if(u&&validUrl(u,origin))out.add(u);
  });
  return [...out];
}

function productLinksFrom(html,url,origin){
  const $=cheerio.load(html),out=new Set();
  $("a[href]").each((_,a)=>{
    const u=absolute(url,$(a).attr("href"));
    if(u&&sameOrigin(u,origin)&&isProductUrl(u))out.add(u);
  });
  return [...out];
}

/* Captura SIN STOCK diretamente da página de listados.
   Isso é mais confiável e rápido que depender exclusivamente de cada ficha. */
function unavailableCards(html,url,origin){
  const $=cheerio.load(html),out=[];
  $("a[href]").each((_,a)=>{
    const href=$(a).attr("href");
    const u=absolute(url,href);
    if(!u||!sameOrigin(u,origin)||!isProductUrl(u))return;

    const card=$(a).closest("article,li,.product,.product-item,.item,.box,.card");
    const scope=card.length?card:$("body");
    const txt=clean(scope.text());
    if(!/\bSIN\s+STOCK\b/i.test(txt))return;

    // Tenta achar o código dentro do mesmo card.
    const code=extractCode(scope);
    if(code)out.push({codigo:code,stock:"1 (SIN STOCK)",sinStock:true});
  });
  return out;
}

app.get("/api/health",(req,res)=>{
  res.json({ok:true,service:"gofly-stock-extractor",version:"3.0"});
});

app.post("/api/stock",async(req,res)=>{
  const origin=String(req.body.origin||DEFAULT_ORIGIN).trim().replace(/\/+$/,"");
  const maxPages=Math.min(Math.max(Number(req.body.maxPages)||1000,1),10000);
  const concurrency=Math.min(Math.max(Number(req.body.concurrency)||3,1),8);

  res.setHeader("Content-Type","application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control","no-cache");
  res.setHeader("X-Accel-Buffering","no");

  let closed=false;
  req.on("close",()=>{closed=true});

  const send=obj=>{
    if(!closed)res.write(JSON.stringify(obj)+"\n");
  };

  try{
    new URL(origin);

    const queue=[origin+"/"];
    const seen=new Set();
    const products=new Set();
    const results=new Map();
    let pages=0,errors=0;

    // Descubrimiento de páginas y fichas.
    while(queue.length && pages<maxPages && !closed){
      const batch=[];
      while(queue.length && batch.length<concurrency && pages+batch.length<maxPages){
        const u=queue.shift();
        if(!seen.has(u)){seen.add(u);batch.push(u)}
      }
      if(!batch.length)break;

      const fetched=await Promise.all(batch.map(async u=>{
        try{return {url:u,html:await fetchHtml(u)}}
        catch(e){return {url:u,error:e.message}}
      }));

      for(const item of fetched){
        pages++;
        if(item.error){
          errors++;
          send({type:"progress",percent:Math.round((pages/maxPages)*45),message:`Error ${item.url}: ${item.error}`});
          continue;
        }

        // 1) Detectar SIN STOCK directamente en tarjetas.
        for(const r of unavailableCards(item.html,item.url,origin)){
          results.set(r.codigo,r);
        }

        // 2) Descubrir fichas.
        for(const p of productLinksFrom(item.html,item.url,origin))products.add(p);

        // 3) Seguir páginas/categorías internas, incluyendo ?page=N.
        for(const l of linksFrom(item.html,item.url,origin)){
          if(!seen.has(l)&&queue.length<maxPages*3)queue.push(l);
        }

        send({
          type:"progress",
          percent:Math.min(45,Math.round((pages/maxPages)*45)),
          message:`Descubriendo catálogo: ${pages} páginas · ${products.size} fichas · ${results.size} sin stock`
        });
      }
      await sleep(100);
    }

    // Consulta individual de fichas para detectar estados que no quedaron visibles
    // en el listado y cantidades numéricas si el sitio las expone.
    const list=[...products];
    let done=0;

    for(let i=0;i<list.length&&!closed;i+=concurrency){
      const batch=list.slice(i,i+concurrency);
      const fetched=await Promise.all(batch.map(async u=>{
        try{return {url:u,html:await fetchHtml(u)}}
        catch(e){return {url:u,error:e.message}}
      }));

      for(const item of fetched){
        done++;
        if(item.error){
          errors++;
          continue;
        }

        const $=cheerio.load(item.html);
        const codigo=extractCode($);
        const stock=extractStock($);

        if(codigo&&stock.value!==null&&stock.value<2){
          results.set(codigo,{
            codigo,
            stock:stock.label,
            sinStock:stock.sinStock
          });
        }
      }

      send({
        type:"progress",
        percent:45+(list.length?Math.round((done/list.length)*55):55),
        message:`REQUEST de stock: ${done}/${list.length} · encontrados < 2: ${results.size}`
      });
      await sleep(100);
    }

    for(const r of results.values()){
      if(r.stock==="NO DETECTADO")continue;
      send({type:"product",data:r});
    }

    send({
      type:"done",
      message:`FINALIZADO. ${results.size} códigos con stock menor a 2. SIN STOCK = 1. Páginas: ${pages}. Fichas: ${done}. Errores: ${errors}.`
    });
  }catch(e){
    send({type:"error",message:e.message});
  }finally{
    res.end();
  }
});

app.listen(PORT,()=>console.log(`GoFlyMX Stock Extractor ejecutándose en http://localhost:${PORT}`));
