// Cloudflare Worker: reenvía solo tienda.goflymx.com y agrega CORS. Uso: https://TU-WORKER.workers.dev/?url=<URL codificada>
export default {
  async fetch(req) {
    const target = new URL(req.url).searchParams.get('url');
    if (!target || !/^https:\/\/tienda\.goflymx\.com\//.test(target)) return new Response('URL no permitida', { status: 400 });
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'es-AR' } });
    const h = new Headers(r.headers);
    h.set('Access-Control-Allow-Origin', '*');
    return new Response(r.body, { status: r.status, headers: h });
  }
};
