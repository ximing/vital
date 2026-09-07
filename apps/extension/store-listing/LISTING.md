# Chrome 网上应用店 · 填写稿

按开发者后台从左到右抄。文案与当前插件行为一致（保存网页 / 选区 / 图片到 Vital 稍后读或待办），不要再加商店里做不到的功能。

上架前先打 **生产包**（现成 `dist` 里是 localhost，审不过）：

```bash
cd /Users/ximing/project/mygithub/vital
WXT_API_URL=https://vital.aimo.plus \
WXT_WEB_URL=https://vital.aimo.plus \
WXT_S3_ENDPOINT=https://s3.aimo.plus \
pnpm --filter @vital/extension build
```

把 `apps/extension/dist/chrome-mv3/` **打成 zip**（zip 根目录要能直接看到 `manifest.json`，不要多套一层文件夹）。`package.json` 的 `version` 现在是 `0.0.0`，上架前改成 `0.1.0`（或你准备对外的版本号）再 build。

本目录资源：

| 文件 | 用途 |
| --- | --- |
| `assets/icon-128.png` | 商店图标（与扩展图标相同） |
| `assets/icon-512.png` | 高清备用 |
| `assets/promo-small-440x280.png` | 小宣传图（必填） |
| `assets/promo-marquee-1400x560.png` | 横幅宣传图（选填，建议传） |
| `assets/promo-large-920x680.png` | 大宣传图（选填） |
| `assets/screenshot-1-save.png` | 截图 1：一键保存 |
| `assets/screenshot-2-menu.png` | 截图 2：右键菜单 |
| `assets/screenshot-3-login.png` | 截图 3：登录面板 |
| `assets/screenshot-4-recent.png` | 截图 4：最近保存 |
| `assets/screenshot-5-edit.png` | 截图 5：保存并编辑 |
| `privacy.html` | 隐私政策，部署后作为商店「隐私权政策」链接 |

隐私政策建议 URL（把 `privacy.html` 放到网站根目录即可）：

`https://vital.aimo.plus/privacy.html`

---

## 1. 商品信息 / Store listing

**语言：** 中文（中国）`zh-CN`  
只建这一个语言。插件 UI 全是中文，不要勾选你没做的语言。

### 商品名称（最多 45 个字符）

```
Vital
```

若希望搜索更清楚，可用（41 字）：

```
Vital：把网页收到稍后读
```

与 manifest `name` 保持「Vital」即可，后台名称可以更完整。

### 摘要 Summary（最多 132 个字符）

```
一键把网页、选区和图片存进 Vital 稍后读，也可存为待办。工具栏或 Alt+Shift+V。
```

字数：44。不要堆关键词。

### 详细说明 Description

```
Vital 扩展用来把正在看的网页收进你的 Vital 稍后读，需要时也可以存成待办。

怎么用
• 点击工具栏图标，保存当前页
• 快捷键 Alt+Shift+V，同样保存当前页
• 在页面、链接、选中文字或图片上右键：保存到稍后读、保存为待办、保存并编辑
• 右键扩展图标 →「最近保存」，打开最近收进来的条目

保存时会抽出标题和正文，方便回 Vital 网页版阅读。同一网址不会重复建两条。图片会存到你的账号，不经过无关第三方。

登录
首次使用请点扩展里的「在网页登录」，在 vital.aimo.plus 登录后会自动连上扩展。登录状态只存在你的 Chrome 配置里。

这不是广告拦截、也不是全站爬虫。只在你主动点保存时读取当前标签页。
```

### 类别 Category

主类别：**效率工具** / Productivity  
不要选「新闻」「社交」。

### 官方网址

```
https://vital.aimo.plus
```

### 支持网址（可与上者相同）

```
https://vital.aimo.plus
```

### 首页网址

```
https://vital.aimo.plus
```

---

## 2. 隐私权实务 / Privacy practices

### 单一用途 Single purpose

英文后台常见字段，中英都备着。填**一句**，不要写产品全家桶。

中文：

```
在用户主动操作时，把当前网页、链接、选中文字或图片保存到该用户的 Vital 稍后读或待办。
```

English：

```
When the user chooses, save the current page, link, selected text, or image to their Vital read-later inbox or tasks.
```

### 是否会收集用户数据？

**是。**

收集的数据仅用于完成上述单一用途（写入用户自己的 Vital 账号）。

勾选（按实际）：

- [x] 个人身份信息（邮箱，用于登录）
- [x] 网站内容（用户主动保存的页面标题、正文、选区、图片、网址）
- [x] 身份验证信息（访问令牌 / 刷新令牌，存在 `chrome.storage`）
- [ ] 位置
- [ ] 健康
- [ ] 财务
- [ ] 通讯录
- [ ] 浏览历史（我们不记录用户没保存的页面）

### 使用目的

- [x] 应用功能（保存到稍后读 / 待办）
- [ ] 广告
- [ ] 分析（若你没接第三方统计，不要勾）
- [ ] 出售给第三方 → **否**

### 是否出售用户数据？

**否。**

### 是否用于与单一用途无关的目的？

**否。**

### 是否使用远程托管代码？

**否。** 所有脚本都打进扩展包。

### 权限说明 Permission justification

逐条粘贴，不要空着。

**storage**  
保存登录令牌、用户资料缓存，以及「保存并编辑」时的草稿。不用于跨站跟踪。

**activeTab**  
用户点击工具栏或使用快捷键时，读取当前标签页的标题、网址和正文以便保存。不会在后台持续读取其它标签。

**scripting**  
在用户主动保存时，向当前页注入脚本以抽取可读正文和用户选中的图片。仅作用于当前次操作的标签页。

**contextMenus**  
提供右键菜单：保存页面、链接、选区、图片，以及存为待办、保存并编辑、最近保存。

**offscreen**  
在扩展的隐藏文档里用 Readability 解析正文、转换不适合直传的图片格式。解析发生在本地扩展进程，不发往第三方解析服务。

**主机权限 `https://vital.aimo.plus/*`**  
Vital 的 API 与网页版同源。用于登录、创建稍后读 / 待办、列出最近保存。

**主机权限 `https://s3.aimo.plus/*`**  
用户保存的图片上传到 Vital 使用的对象存储。仅上传用户主动保存的图片。

（若生产包里还有其它 host，按同样句式写「只用于 Vital 后端」。不要带 `localhost` 上架。）

---

## 3. 发布范围

- 可见性：**公开**
- 地区：全部（或你实际服务的地区）
- 价格：**免费**
- 成熟度：未满 18 岁可用（不涉及成人内容）→ 选适合所有年龄

首次发布需 Google 开发者注册费（一次性）。

---

## 4. 审核时可能被问到的话术

**为什么要 scripting + activeTab？**  
保存网页必须读 DOM 才能抽出正文。只在用户点击或快捷键时注入，不用 `tabs` 权限扫全部标签。

**为什么不用 `<all_urls>`？**  
故意不用。只申请 API / 存储域名；当前页靠 activeTab。

**和 Vital App 是什么关系？**  
同一产品的浏览器入口。扩展只负责「从网页收进来」；阅读、待办、复盘在 vital.aimo.plus。

---

## 5. 图形资源规格（已导出到 `assets/`）

| 资源 | 尺寸 | 必填 |
| --- | --- | --- |
| 商店图标 | 128 × 128 PNG | 是 |
| 截图 | 1280 × 800 PNG，最多 5 张 | 至少 1 |
| 小宣传图 | 440 × 280 PNG | 是 |
| 大宣传图 | 920 × 680 PNG | 否 |
| 横幅 | 1400 × 560 PNG | 否 |

截图不要纯营销海报，必须能看出扩展界面。本目录截图按真实文案和面板样式制作。

---

## 6. 自检

- [ ] 生产 `host_permissions` 只有 `vital.aimo.plus` 与 `s3.aimo.plus`，没有 localhost
- [ ] `version` 不是 `0.0.0`
- [ ] zip 根上就是 `manifest.json`
- [ ] 隐私政策 URL 已公网可打开 HTTPS
- [ ] 摘要 / 说明没有写插件做不到的功能
- [ ] 截图里的文案与插件一致（中文）
