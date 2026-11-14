# dsh-mail-notify

让 DSH 主动给主人邮箱发一封提示。适合：长任务跑完、定时巡检发现问题、人已经离开电脑但想知道结果。

## 配置

配置文件 `~/.dsh/mail.json`（也可以全用环境变量覆盖）：

```json
{
  "host": "smtp.example.com",
  "port": 465,
  "user": "you@example.com",
  "pass": "你的授权码，不是登录密码",
  "to": "you@example.com",
  "from": "you@example.com"
}
```

| 字段 | 环境变量 | 说明 |
|---|---|---|
| `host` | `DSH_MAIL_HOST` | SMTP 服务器，默认走隐式 TLS（465） |
| `port` | `DSH_MAIL_PORT` | 默认 465 |
| `user` | `DSH_MAIL_USER` | 登录账号 |
| `pass` | `DSH_MAIL_PASS` | 163/QQ 邮箱要用**授权码**，不是登录密码 |
| `to` | `DSH_MAIL_TO` | 默认收件人（主人邮箱） |
| `from` | `DSH_MAIL_FROM` | 缺省同 `user` |

## 工具

`mail_notify(subject, body, to?)` —— 纯文本，返回 `{ ok, to, subject, note? }`。

```json
{ "subject": "夜间巡检：插件市场能搜到了", "body": "PR #15322 已合并。\nhttps://github.com/..." }
```

## 实现说明

- 只用 Node 标准库的 `tls`，没有第三方依赖（插件通过 `link:` 装，自己带不了 node_modules）
- 隐式 TLS（465）+ `AUTH LOGIN`，正文非 ASCII 时分块 base64，标题用 encoded-word
- DATA 阶段做了 dot-stuffing，正文里以 `.` 开头的行不会被当成结束符

## 限制

- 不支持附件和 HTML 正文
- 不支持 STARTTLS（587 端口）
- 单次一封、串行发送；批量通知请自己循环
