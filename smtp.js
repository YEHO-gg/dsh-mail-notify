/**
 * 极简 SMTP 客户端（隐式 TLS，465）。
 *
 * 为什么不用 nodemailer：插件通过 link: 装进 profile，自己带不了依赖；
 * 而 SMTP 的基础流程只有几条命令，标准库 tls 就够。
 *
 * 支持：EHLO / AUTH LOGIN / MAIL FROM / RCPT TO / DATA / QUIT
 * 不做：附件、HTML 之外的复杂 MIME、STARTTLS（465 是隐式 TLS，不需要）
 */

import { connect } from 'node:tls';
import { randomBytes } from 'node:crypto';

const CRLF = '\r\n';

/** 读一条 SMTP 响应：多行以 "250-" 开头，最后一行是 "250 "。 */
function readReply(socket, state) {
  return new Promise((resolve, reject) => {
    let buf = state.buffer;
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      // 找到最后一行 "NNN " 形式的结束标记
      const lines = buf.split(CRLF).filter((l) => l.length > 0);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        state.buffer = '';
        resolve({ code: Number(last.slice(0, 3)), text: buf });
        return;
      }
      state.buffer = buf;
    };
    const onError = (err) => { cleanup(); reject(err); };
    const onClose = () => { cleanup(); reject(new Error('SMTP connection closed early')); };
    function cleanup() {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function send(socket, state, line, expect = [250, 235, 354, 221]) {
  socket.write(line + CRLF);
  const reply = await readReply(socket, state);
  if (!expect.includes(reply.code)) {
    throw new Error(`SMTP ${line.split(' ')[0]} 失败: ${reply.text.trim()}`);
  }
  return reply;
}

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

/** RFC 5322 头里的非 ASCII 需要 encoded-word。 */
function encodeHeader(value) {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${b64(value)}?=`;
}

function encodeBody(text) {
  // 7bit 能过就直接发；否则 base64，最省事也最不容易被拆行破坏
  if (/^[\x20-\x7E\r\n\t]*$/.test(text)) {
    return { headers: ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 7bit'], body: text };
  }
  return {
    headers: ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'],
    body: Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1' + CRLF),
  };
}

/**
 * 发一封纯文本邮件。
 * @param {{host:string, port?:number, user:string, pass:string, from?:string, to:string|string[], subject:string, text:string, timeoutMs?:number}} o
 */
export async function sendMail(o) {
  const {
    host, port = 465, user, pass,
    from = user, subject, text,
    timeoutMs = 20_000,
  } = o;
  const to = Array.isArray(o.to) ? o.to : [o.to];
  if (!host || !user || !pass) throw new Error('缺少 SMTP 配置（host / user / pass）');
  if (!to.length || to.some((t) => !t)) throw new Error('缺少收件人');

  const state = { buffer: '' };
  const socket = connect({ host, port, servername: host, timeout: timeoutMs });
  socket.setEncoding('utf8');

  try {
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
      socket.once('timeout', () => reject(new Error(`连接 ${host}:${port} 超时`)));
    });

    await readReply(socket, state);                       // 220 greeting
    await send(socket, state, 'EHLO dsh-mail-notify');    // 250
    await send(socket, state, 'AUTH LOGIN', [334]);       // 334
    await send(socket, state, b64(user), [334]);          // 334
    await send(socket, state, b64(pass), [235]);          // 235
    await send(socket, state, `MAIL FROM:<${from}>`);     // 250
    for (const rcpt of to) await send(socket, state, `RCPT TO:<${rcpt}>`, [250, 251]);
    await send(socket, state, 'DATA', [354]);             // 354

    const enc = encodeBody(text);
    const boundaryId = randomBytes(8).toString('hex');
    const headers = [
      `From: ${encodeHeader(from)}`,
      `To: ${to.map(encodeHeader).join(', ')}`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${boundaryId}@dsh-mail-notify>`,
      'MIME-Version: 1.0',
      ...enc.headers,
    ];
    const payload = headers.join(CRLF) + CRLF + CRLF + enc.body;

    // DATA 结束标记；正文里以 "." 开头的行要做 dot-stuffing
    const stuffed = payload.split(CRLF).map((l) => (l.startsWith('.') ? '.' + l : l)).join(CRLF);
    socket.write(stuffed + CRLF + '.' + CRLF);
    const done = await readReply(socket, state);
    if (done.code !== 250) throw new Error(`SMTP 投递失败: ${done.text.trim()}`);

    try { await send(socket, state, 'QUIT', [221]); } catch { /* 不重要 */ }
    return { ok: true, to, subject };
  } finally {
    socket.destroy();
  }
}
