// Avisos de YouTube para el Discord de TAKERO GAMER.
// GitHub Actions lo ejecuta cada 10 minutos: lee el canal de YouTube y, si hay
// un video nuevo, lo publica en Discord mediante un webhook (sin bots).

const fs = require('fs');

// ─── Configuración ───────────────────────────────────────────────
const YOUTUBE_HANDLE = '@takerogameroficial'; // el @ de tu canal
const YOUTUBE_CHANNEL_ID = '';                // opcional (UC…); si está vacío se busca a partir del @
const ROLE_AVISOS_VIDEOS = '1569164554569519145'; // rol 🔔 AVISOS DE VIDEOS
const MAX_POR_EJECUCION = 5;
// ─────────────────────────────────────────────────────────────────

const HOOK_VIDEOS = process.env.DISCORD_WEBHOOK_VIDEOS;
const HOOK_SHORTS = process.env.DISCORD_WEBHOOK_SHORTS || HOOK_VIDEOS;
const STATE_FILE = 'state.json';

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: (e.match(/<yt:videoId>([^<]+)/) || [])[1],
    title: decode((e.match(/<title>([^<]*)/) || [])[1] || ''),
    url: (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1],
    published: (e.match(/<published>([^<]+)/) || [])[1],
  })).filter((v) => v.id && v.url);
}

async function post(hook, content) {
  const res = await fetch(`${hook}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      username: 'TAKERO GAMER',
      allowed_mentions: { roles: ROLE_AVISOS_VIDEOS !== 'PENDIENTE' ? [ROLE_AVISOS_VIDEOS] : [] },
    }),
  });
  if (!res.ok) throw new Error(`Discord respondió ${res.status}: ${await res.text()}`);
}

// Busca el ID del canal (UC…) a partir del @. Devuelve null si el canal aún no existe.
async function resolveChannelId() {
  const res = await fetch(`https://www.youtube.com/${YOUTUBE_HANDLE}`, {
    headers: { 'Accept-Language': 'es', 'User-Agent': 'Mozilla/5.0', Cookie: 'CONSENT=YES+1' },
  });
  if (res.status === 404) return null;
  const html = await res.text();
  // externalId y el enlace canónico son el ID del propio canal (no de canales enlazados en la página)
  return (html.match(/"externalId":"(UC[\w-]{22})"/)
    || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)
    || [])[1] || null;
}

(async () => {
  if (!HOOK_VIDEOS) throw new Error('Falta el secreto DISCORD_WEBHOOK_VIDEOS en GitHub.');

  const firstRun = !fs.existsSync(STATE_FILE);
  const state = firstRun ? { seen: [] } : JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const channelId = YOUTUBE_CHANNEL_ID || state.channelId || await resolveChannelId();
  if (!channelId) {
    // Si el canal aún no existe, todo lo que se publique después será nuevo y se avisará.
    if (firstRun) fs.writeFileSync(STATE_FILE, JSON.stringify({ seen: [] }, null, 2));
    console.log(`El canal ${YOUTUBE_HANDLE} todavía no existe en YouTube. Se volverá a intentar en la próxima ejecución.`);
    return;
  }

  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (res.status === 404) { console.log('El canal existe pero YouTube aún no publica su feed. Se reintentará.'); return; }
  if (!res.ok) throw new Error(`YouTube respondió ${res.status}`);
  const videos = parseFeed(await res.text());

  // Primera ejecución: se guardan los videos actuales sin avisar, para no llenar el canal.
  if (firstRun) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ channelId, seen: videos.map((v) => v.id) }, null, 2));
    console.log(`Primera ejecución (${channelId}): ${videos.length} videos existentes guardados sin avisar.`);
    return;
  }

  const seen = new Set(state.seen);
  const nuevos = videos.filter((v) => !seen.has(v.id))
    .sort((a, b) => a.published.localeCompare(b.published))
    .slice(-MAX_POR_EJECUCION);

  const mention = ROLE_AVISOS_VIDEOS !== 'PENDIENTE' ? `\n<@&${ROLE_AVISOS_VIDEOS}>` : '';
  for (const v of nuevos) {
    const short = v.url.includes('/shorts/');
    const content = short
      ? `⚡ **¡Nuevo short!** — ${v.title}\n${v.url}`
      : `🎥 **¡Nuevo video!** — ${v.title}\n${v.url}${mention}`;
    await post(short ? HOOK_SHORTS : HOOK_VIDEOS, content);
    seen.add(v.id); // solo se marca como avisado si Discord lo aceptó
    console.log(`Avisado: ${v.title}`);
  }

  const ordered = videos.map((v) => v.id).filter((id) => seen.has(id));
  fs.writeFileSync(STATE_FILE, JSON.stringify({ channelId, seen: [...new Set([...ordered, ...state.seen])].slice(0, 60) }, null, 2));
  if (!nuevos.length) console.log('Sin videos nuevos.');
})().catch((e) => { console.error(e.message); process.exit(1); });
