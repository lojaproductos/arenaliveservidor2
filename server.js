// Servidor da Arena: conecta na live do TikTok e repassa comentários e presentes ao site (WebSocket).
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { TikTokLiveConnection } from 'tiktok-live-connector';

const PORT = process.env.PORT || 3000;
const SIGN_API_KEY = process.env.SIGN_API_KEY || ''; // opcional (eulerstream.com): deixa a conexão mais estável
const MAX_ROOMS = 10;

const norm = u => String(u || '').trim().toLowerCase()
  .replace(/^https?:\/\/(www\.)?tiktok\.com\//, '').replace(/^@/, '').split(/[\/?#]/)[0];
const ALLOWED = (process.env.ALLOWED_USERS || '').split(',').map(norm).filter(Boolean); // opcional: só estes @ podem usar

const rooms = new Map(); // @usuario -> sala
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const send = (ws, o) => { if (ws.readyState === 1) { try { ws.send(JSON.stringify(o)); } catch (e) {} } };
const cast = (room, o) => room.subs.forEach(ws => send(ws, o));
const st = (state, text) => ({ type: 'status', state, text });

// ---------- HTTP (saúde do servidor)
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([...rooms.values()].map(r => ({ user: r.user, live: r.live, viewers: r.subs.size, ...r.stats }))));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Servidor da Arena no ar ✅');
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });

// ---------- sala = uma conexão com a live de um @
function openRoom(user) {
  const room = { user, subs: new Set(), conn: null, live: false, stop: false, timer: null, stats: { chat: 0, gift: 0 } };
  const again = ms => { if (room.stop || room.timer) return; room.timer = setTimeout(() => { room.timer = null; start(); }, ms); };

  async function start() {
    if (room.stop) return;
    try { room.conn?.disconnect?.().catch?.(() => {}); } catch (e) {}
    const conn = new TikTokLiveConnection(user, SIGN_API_KEY ? { signApiKey: SIGN_API_KEY } : {});
    room.conn = conn; room.live = false;
    cast(room, st('wait', 'Conectando em @' + user + '...'));

    conn.on('chat', d => {
      room.stats.chat++;
      cast(room, { type: 'chat', user: d.user?.uniqueId ?? d.uniqueId ?? '', text: String(d.comment ?? '') });
    });

    conn.on('gift', d => {
      const g = d.giftDetails || {}, ext = d.extendedGiftInfo || {};
      const type = g.giftType ?? ext.type ?? d.giftType;
      const ended = d.repeatEnd === true || d.repeatEnd === 1 || d.repeatEnd === '1';
      if (type === 1 && !ended) return; // sequência (combo) ainda rolando: conta só no final
      const gift = {
        type: 'gift',
        user: d.user?.uniqueId ?? d.uniqueId ?? '',
        id: d.giftId ?? g.id ?? ext.id ?? '',
        name: g.giftName || ext.name || d.giftName || ('Gift ' + (d.giftId ?? '')),
        image: g.giftImage?.giftPictureUrl || g.giftImage?.url_list?.[0] || ext.image?.url_list?.[0] || d.giftPictureUrl || '',
        coins: Number(g.diamondCount ?? ext.diamond_count ?? d.diamondCount ?? 1) || 1,
        count: Math.max(1, Number(d.repeatCount) || 1)
      };
      room.stats.gift++;
      log('🎁', '@' + user, gift.user, gift.name, '×' + gift.count, gift.coins + ' moedas');
      cast(room, gift);
    });

    conn.on('streamEnd', () => { room.live = false; cast(room, st('offline', 'A live acabou. Aguardando voltar...')); });
    conn.on('disconnected', () => {
      room.live = false;
      if (room.stop) return;
      cast(room, st('wait', 'Live desconectou. Reconectando...'));
      again(8000);
    });
    conn.on('error', e => log('erro da conexão:', e?.message || e));

    try {
      await conn.connect();
      room.live = true;
      log('✅ conectado em @' + user);
      cast(room, st('live', '✅ Conectado na live de @' + user));
    } catch (e) {
      room.live = false;
      const msg = String(e?.message || e), off = /offline|not.*live|UserOffline/i.test((e?.name || '') + msg);
      log(off ? '⏳ @' + user + ' não está ao vivo' : '❌ falha: ' + msg);
      cast(room, st(off ? 'offline' : 'error', off ? '@' + user + ' não está ao vivo agora. Aguardando...' : 'Falha ao conectar: ' + msg.slice(0, 120)));
      again(off ? 20000 : 15000);
    }
  }
  room.start = start;
  return room;
}

function leave(ws) {
  const room = rooms.get(ws.room);
  ws.room = null;
  if (!room) return;
  room.subs.delete(ws);
  if (!room.subs.size) {
    room.stop = true; clearTimeout(room.timer);
    try { room.conn?.disconnect?.().catch?.(() => {}); } catch (e) {}
    rooms.delete(room.user);
    log('sala encerrada: @' + room.user);
  }
}

wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('error', () => {});
  ws.on('message', raw => {
    let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
    if (m.type !== 'connect') return;
    const user = norm(m.user);
    if (!user) return send(ws, st('error', 'Digite o @ do TikTok'));
    if (ALLOWED.length && !ALLOWED.includes(user)) return send(ws, st('error', 'Este @ não é permitido neste servidor'));
    if (ws.room === user) return;
    leave(ws);
    let room = rooms.get(user);
    if (!room) {
      if (rooms.size >= MAX_ROOMS) return send(ws, st('error', 'Servidor cheio, tente mais tarde'));
      room = openRoom(user); rooms.set(user, room); room.subs.add(ws); ws.room = user; room.start();
    } else {
      room.subs.add(ws); ws.room = user;
      send(ws, room.live ? st('live', '✅ Conectado na live de @' + user) : st('wait', 'Conectando em @' + user + '...'));
    }
    log('site conectado em @' + user + ' (' + room.subs.size + ')');
  });
  ws.on('close', () => leave(ws));
});

// mantém as conexões vivas (o Render derruba conexões paradas) e derruba as mortas
setInterval(() => wss.clients.forEach(ws => {
  if (ws.alive === false) return ws.terminate();
  ws.alive = false; try { ws.ping(); } catch (e) {}
  send(ws, { type: 'hb', t: Date.now() });
}), 25000);

process.on('unhandledRejection', e => log('unhandledRejection:', e?.message || e));
process.on('uncaughtException', e => log('uncaughtException:', e?.message || e));
server.listen(PORT, '0.0.0.0', () => log('Arena no ar na porta ' + PORT));
