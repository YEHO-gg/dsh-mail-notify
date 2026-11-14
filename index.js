/**
 * dsh-mail-notify —— 给主人的邮箱发一条提示。
 *
 * 用途：长任务跑完、定时巡检发现问题、需要人在手机上看一眼时，
 * 让 DSH 主动发一封邮件，而不是等人回来翻对话。
 *
 * 配置来源（优先级从高到低）：
 *   1) 环境变量 DSH_MAIL_HOST / DSH_MAIL_PORT / DSH_MAIL_USER / DSH_MAIL_PASS / DSH_MAIL_TO
 *   2) ~/.dsh/mail.json：{ "host": "...", "port": 465, "user": "...", "pass": "...", "to": "..." }
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { sendMail } from './smtp.js';

export const name = 'mail-notify';
export const inject = ['tools'];

const CONFIG_FILE = path.join(homedir(), '.dsh', 'mail.json');

function readConfigFile() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function resolveConfig() {
  const file = readConfigFile();
  const env = process.env;
  const pick = (envKey, fileKey, fallback) =>
    (env[envKey] && String(env[envKey]).trim()) || file[fileKey] || fallback;
  return {
    host: pick('DSH_MAIL_HOST', 'host', ''),
    port: Number(pick('DSH_MAIL_PORT', 'port', 465)),
    user: pick('DSH_MAIL_USER', 'user', ''),
    pass: pick('DSH_MAIL_PASS', 'pass', ''),
    to: pick('DSH_MAIL_TO', 'to', ''),
    from: pick('DSH_MAIL_FROM', 'from', ''),
  };
}

const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string', description: '邮件标题，一句话说清是什么事。' },
    body: { type: 'string', description: '邮件正文，纯文本，支持换行。' },
    to: { type: 'string', description: '可选：收件人邮箱。默认发给配置里的主人邮箱。' },
  },
  required: ['subject', 'body'],
};

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    to: { type: 'string' },
    subject: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['ok', 'to', 'subject'],
};

const tool = {
  name: 'mail_notify',
  description:
    '给主人邮箱发一封提示邮件（纯文本）。当长任务完成、定时巡检发现问题、或需要人离开电脑后仍能看到结果时使用。不要用它发垃圾邮件；同一件事不要重复发。',
  parameters,
  output: {
    schema: outputSchema,
    render(_args, value) {
      if (!value.ok) return [{ type: 'text', text: `邮件未发送：${value.note ?? '未知原因'}` }];
      return [{ type: 'text', text: `已发送邮件给 ${value.to}：${value.subject}` }];
    },
  },
  timeoutMs: 40_000,
  isConcurrencySafe: () => true,
  async execute(args) {
    const cfg = resolveConfig();
    const to = (args?.to || cfg.to || '').trim();
    if (!to) {
      return { ok: false, to: '', subject: args?.subject ?? '', note: `缺少收件人：在 ${CONFIG_FILE} 里写 to，或用 DSH_MAIL_TO` };
    }
    if (!cfg.host || !cfg.user || !cfg.pass) {
      return { ok: false, to, subject: args?.subject ?? '', note: `SMTP 未配置：在 ${CONFIG_FILE} 里写 host / user / pass` };
    }
    try {
      await sendMail({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        pass: cfg.pass,
        from: cfg.from || cfg.user,
        to,
        subject: String(args?.subject ?? '(无标题)'),
        text: String(args?.body ?? ''),
      });
      return { ok: true, to, subject: String(args?.subject ?? '') };
    } catch (error) {
      return { ok: false, to, subject: String(args?.subject ?? ''), note: String(error?.message ?? error) };
    }
  },
  presentCall(args) {
    return { card: 'generic', title: `发邮件 · ${args?.subject ?? ''}`, rawInput: args };
  },
};

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(tool), 'mail_notify tool');
}
