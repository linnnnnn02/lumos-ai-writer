# Supabase 密码重置邮件模板

Lumos 使用两段式密码重置链接，避免 163 等邮箱的安全扫描器提前消耗 Supabase 一次性链接。

在 Supabase Dashboard 的 `Authentication` -> `Email Templates` -> `Reset Password` 中，将正文中的重置按钮链接改为：

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">
  继续重置密码
</a>
```

推荐使用下面的完整正文：

```html
<h2>重置 Lumos 登录密码</h2>
<p>你正在为 Lumos 账号设置新密码。</p>
<p>
  <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">
    继续重置密码
  </a>
</p>
<p>进入 Lumos 后，请再次点击“继续重置密码”完成安全验证。</p>
<p>如果不是你发起的操作，可以忽略这封邮件。</p>
```

不要继续使用 `{{ .ConfirmationURL }}` 作为密码重置按钮地址。该地址会在第一次访问时消耗凭证，可能被邮箱安全扫描器提前触发。
