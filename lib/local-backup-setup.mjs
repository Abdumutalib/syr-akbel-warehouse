import http from 'node:http';
import crypto from 'node:crypto';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(body, refresh = false) {
  return `<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="5">' : ''}<title>AKBEL — захира нусхалаш</title><style>body{font:18px system-ui;background:#f5f1ea;color:#231c16;max-width:620px;margin:50px auto;padding:24px}main{padding:28px;border-radius:20px;background:white}input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;margin:8px 0 20px}button{background:#80512c;color:white;border:0;border-radius:8px;cursor:pointer}p{line-height:1.55}label{display:block}small{color:#62594e}a{color:#80512c}</style><main>${body}</main></html>`;
}

// This local UI never accepts external source URLs or serves arbitrary files.
// Only the holder of this process's random URL can access it.
export function createLocalBackupSetup({ configure, getStatus = async () => null, port = 8794, nonce = crypto.randomBytes(24).toString('hex') }) {
  const origin = `http://127.0.0.1:${port}`;
  const route = `/${nonce}`;
  let busy = false;
  let configured = false;
  const server = http.createServer(async (req, res) => {
    const send = (code, body, refresh = false) => {
      res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(page(body, refresh));
    };
    if (req.headers.host !== `127.0.0.1:${port}`) { send(403, '<p>Киришга рухсат йўқ.</p>'); return; }
    const path = new URL(req.url, origin).pathname;
    if (![route, route + '/status'].includes(path)) { send(404, '<p>Саҳифа топилмади.</p>'); return; }
    if (req.method === 'GET') {
      if (configured || path.endsWith('/status')) {
        let status = null;
        try { status = await getStatus(); } catch {}
        const info = status?.ok
          ? `<h1>Нусха сақланди ✓</h1><p>Охирги олинган маълумот: <strong>${escape(status.capturedAt)}</strong></p><p>Расмлар: ${escape(status.photos)}</p><p>Маълумотлар шифрланган ҳолда компьютерда сақланмоқда.</p><p><a href="http://127.0.0.1:8793/warehouse/admin">Маҳаллий нусхани очиш</a></p>`
          : status?.ok === false
            ? '<h1>Уланишни кутаяпти</h1><p>Охирги нусхалаш уриниши муваффақиятли бўлмади. Дастур қайта уринади; аввалги тўлиқ нусха сақланади.</p>'
            : '<h1>Нусхалаш бошланмоқда…</h1><p>Биринчи нусха ва расмлар олинмоқда. Саҳифа автоматик янгиланади.</p>';
        send(200, info + '<small>Бу маҳаллий нусхалаш ҳолати. Барча сотувчилар учун автоматик захира серверга ўтиш ёқилмаган.</small>', true);
      } else {
        send(200, `<h1>AKBEL — компьютерга захира</h1><p>Сайт админининг логин-паролини киритинг. Дастур уларни <strong>https://akbelim.com</strong> билан уланиш учун ишлатади ва компьютерда Windows ҳимояси билан шифрлаб сақлайди.</p><form action="${route}" method="post"><label>Сайт админининг логини<input name="username" autocomplete="username" required maxlength="200"></label><label>Сайт админининг пароли<input type="password" name="password" autocomplete="current-password" required maxlength="1000"></label><button>Нусхалашни бошлаш</button></form><small>Паролни чатга юбориш керак эмас. Нусхалаш маълумотларни сайтдан ўчирмайди ёки ўзгартирмайди.</small>`);
      }
      return;
    }
    if (req.method !== 'POST' || path !== route) { send(405, '<p>Рухсат берилмаган сўров.</p>'); return; }
    if (req.headers.origin !== origin || !String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) { send(403, '<p>Киришга рухсат йўқ.</p>'); return; }
    if (configured || busy) { send(409, '<p>Нусхалаш аллақачон ишга туширилмоқда.</p>'); return; }
    busy = true;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { send(413, '<p>Сўров жуда катта.</p>'); return; }
        chunks.push(chunk);
      }
      const data = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const username = (data.get('username') || '').trim();
      const password = data.get('password') || '';
      if (!username || !password || username.length > 200 || password.length > 1000) { send(400, '<p>Логин ва паролни киритинг.</p>'); return; }
      await configure({ username, password });
      configured = true;
      res.writeHead(303, { Location: route + '/status', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end();
    } catch {
      // Credentials, source responses and errors never appear in HTML or logs.
      send(400, `<h1>Уланиш тасдиқланмади</h1><p>Админ логин-пароли, интернет ёки дискка сақлашни текшириш керак.</p><a href="${route}">Қайта киритиш</a>`);
    } finally { busy = false; }
  });
  return { server, url: origin + route, markConfigured() { configured = true; } };
}
