# 从旧版 dsh-tavern-image 迁移到 Tavern 内置版

> **适用对象**：以前单独装过 `dsh-tavern-image` 插件、现在升级到 DSH Tavern 3.0 的用户。
>
> **一句话结论**：数据**不会自动搬**。新版装的是空插件，你要手动把 8 样数据复制过去。

---

## 为什么不会自动搬

内置安装器源码写得很直接：

```
* - 只首装：目标目录一旦存在就跳过，不判断版本、不覆盖、不碰用户数据。
```

```
// Any existing entry is user-owned: this includes broken directories and symlinks.
```

两件事叠加的结果：新位置（`data/plugins/`）是空的，所以装一份新的（空数据）；旧位置（`data/tools/`）的数据没人管。**旧插件和新插件在不同的目录，这是设计如此，不是 bug。**

---

## 第 0 步：先判断你在哪种情况

打开终端（Windows 用 PowerShell，macOS/Linux 用终端），一次跑完：

```powershell
# Windows
@(
  "$env:USERPROFILE\.dsh\profile-data\tavern\data\tools\dsh-tavern-image",
  "$env:USERPROFILE\.dsh\profile-data\tavern\data\plugins\dsh-tavern-image"
) | ForEach-Object { "$(Test-Path $_)  $_" }
```

```bash
# macOS / Linux
for p in \
  "$HOME/.dsh/profile-data/tavern/data/tools/dsh-tavern-image" \
  "$HOME/.dsh/profile-data/tavern/data/plugins/dsh-tavern-image"; do
  [ -d "$p" ] && echo "有  $p" || echo "无  $p"
done
```

对照结果：

| `tools/` | `plugins/` | 你的情况 | 从哪一步开始 |
|---|---|---|---|
| 有 | 无 | 典型旧版，还没升级 | 第 1 步 |
| 有 | 有 | 升级过但数据没搬 | 第 3 步 |
| 无 | 有 | 已经搬好或全新安装 | 直接看最后一节「验证」 |
| 无 | 无 | 没装过旧版 | 装 Tavern 3.0 就行，不用迁移 |

**如果两个都没有，但确定以前用过**，先找数据：

```powershell
Get-ChildItem "$env:USERPROFILE\.dsh" -Recurse -Filter definitions.json -Depth 6 -ErrorAction SilentlyContinue |
  Where-Object { $_.Length -gt 500 } | Select-Object FullName, Length, LastWriteTime
```

```bash
find "$HOME/.dsh" -maxdepth 6 -name definitions.json -size +500c 2>/dev/null
```

`definitions.json` 超过 500 字节的就是有真实数据的那份，那个目录就是你要找的旧插件目录。

---

## 第 1 步：备份（必须做，不做别往下走）

```powershell
# Windows
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item "$env:USERPROFILE\.dsh\profile-data\tavern\data\tools\dsh-tavern-image" `
          "$env:USERPROFILE\Desktop\dsh-tavern-image-backup-$stamp" -Recurse -Force
```

```bash
# macOS / Linux
stamp=$(date +%Y%m%d-%H%M%S)
cp -R "$HOME/.dsh/profile-data/tavern/data/tools/dsh-tavern-image" \
      "$HOME/Desktop/dsh-tavern-image-backup-$stamp"
```

---

## 第 2 步：清掉旧安装

旧版靠 profile 里的一个软链接（junction / symlink）挂载。**这个链接必须删**，否则新版装上后 Tavern 会同时看到两份同名插件。

```powershell
# Windows
cmd /c rmdir "$env:USERPROFILE\.dsh\profiles\tavern\node_modules\dsh-tavern-comfy"

# 然后把整个旧目录移出 tools\
Move-Item "$env:USERPROFILE\.dsh\profile-data\tavern\data\tools\dsh-tavern-image" `
          "$env:USERPROFILE\.dsh\backups\dsh-tavern-image-old"
```

```bash
# macOS / Linux
rm -f "$HOME/.dsh/profiles/tavern/node_modules/dsh-tavern-comfy"
mkdir -p "$HOME/.dsh/backups"
mv "$HOME/.dsh/profile-data/tavern/data/tools/dsh-tavern-image" \
   "$HOME/.dsh/backups/dsh-tavern-image-old"
```

### 为什么必须「移走」而不是只改名留在原地

`data/tools/` 目录下只要有一个**不是插件**的目录（改名留下的空壳、备份目录），DSH 启动扫描时会尝试加载它、加载失败，然后**把 `data/tools.cordis.yml` 覆写成 `[]`**。后果是**你所有自制插件一起失效**，桌面上还会弹：

```
failed to validate config file ...\data\tools.cordis.yml
```

所以旧目录要**整个搬到 `backups/` 去**，不要留在 `tools/` 里。

> 如果你在 `tools/` 里看到 `card-updater`、`wrongbook` 这类只有 `config.json` / `state.json` / `backups/` 的目录，**那没问题**，它们是 DSH 内置插件的数据目录，不是插件本体。

---

## 第 3 步：升级 / 安装 Tavern 3.0

正常升级，插件会作为内置插件自动装好。

装完先确认这个目录出现：

```powershell
Test-Path "$env:USERPROFILE\.dsh\profile-data\tavern\data\plugins\dsh-tavern-image"
# 应输出 True
```

```bash
[ -d "$HOME/.dsh/profile-data/tavern/data/plugins/dsh-tavern-image" ] && echo OK
```

如果不存在，进 Tavern 设置 → 插件 → 找到「剧情生图 / 本地生图」→ 点安装。

---

## 第 4 步：只搬这 8 样数据

**复制 6 个文件 + 2 个目录**，别多别少。

```powershell
# Windows
$old = "$env:USERPROFILE\.dsh\backups\dsh-tavern-image-old"
$new = "$env:USERPROFILE\.dsh\profile-data\tavern\data\plugins\dsh-tavern-image"

foreach ($f in 'definitions.json','worldbook.json','worldbook-outfits.json',
               'config.json','jobs-store.json','plans-store.json') {
  if (Test-Path "$old\$f") { Copy-Item "$old\$f" "$new\$f" -Force; Write-Host "复制 $f" }
}
foreach ($d in 'cache','backups') {
  if (Test-Path "$old\$d") { Copy-Item "$old\$d" "$new\$d" -Recurse -Force; Write-Host "复制 $d\" }
}
```

```bash
# macOS / Linux
old="$HOME/.dsh/backups/dsh-tavern-image-old"
new="$HOME/.dsh/profile-data/tavern/data/plugins/dsh-tavern-image"

for f in definitions.json worldbook.json worldbook-outfits.json \
         config.json jobs-store.json plans-store.json; do
  [ -f "$old/$f" ] && cp "$old/$f" "$new/$f" && echo "复制 $f"
done
for d in cache backups; do
  [ -d "$old/$d" ] && cp -R "$old/$d" "$new/$d" && echo "复制 $d/"
done
```

### 每一样是什么、丢了会怎样

| 文件 / 目录 | 里面是什么 | 不搬的后果 |
|---|---|---|
| `definitions.json` | 角色库：人物、12 块 traits、服装 | 人物全没了，要重新建 |
| `worldbook.json` | 生图规则世界书 | 出图风格、画法规则全部丢失 |
| `worldbook-outfits.json` | 角色与服装库世界书 | 服装相关规则丢失 |
| `config.json` | 渠道地址、密钥、模型、分辨率、预设 | 要重新配一遍渠道 |
| `jobs-store.json` | 出图记录索引 | 历史图列表变空 |
| `plans-store.json` | 生图规划记录 | 规划历史清空 |
| `cache/` | 图片本体 | 历史图看得见记录但显示不出图 |
| `backups/` | 插件自动备份 | 没法回滚 |

### 千万不要搬这些

`lib/`、`client.js`、`console.html`、`package.json`、`cordis.patch.yml`、`.tavern-entry.mjs`、`scripts/`、`design-rules.md`、`README.md`、`LICENSE`、`世界书-*.json`（种子文件）

这些是**代码**。搬过去会把新版代码覆盖成旧版，等于把插件降级——正好反了。

**尤其不要用这一条：**
```powershell
Copy-Item "$old\*" "$new\" -Recurse -Force   # ← 错误做法
```

---

## 第 5 步：完整重启 DSH

托盘图标 → **退出** → 重新打开。

**刷新页面不够**，插件是宿主侧加载的。

重启后可以这样确认加载成功：

```powershell
Get-Content "$env:USERPROFILE\.dsh\profile-data\tavern\data\plugins\dsh-tavern-image\.tavern-status.json"
```

```bash
cat "$HOME/.dsh/profile-data/tavern/data/plugins/dsh-tavern-image/.tavern-status.json"
```

看到 `{"ok":true,...}` 就是加载成功。如果是 `{"ok":false,...}`，里面会写失败阶段和错误信息。

---

## 第 6 步：验证清单

打开 Tavern 设置 → **本地生图**，逐项对照：

- [ ] **人物库**里角色数量对得上（能看见你原来的角色名）
- [ ] 每个角色的 12 块 traits 里内容还在（不是空白）
- [ ] **世界书**两本都在，条目数对得上
- [ ] **渠道**地址和密钥还在，点「测试连接」能通
- [ ] **历史图**能看到旧图（搬了 `cache/` 才有图，否则只有记录）
- [ ] 随便点一张「重画」，能正常出新图

---

## 常见问题

### Q：升级后角色库是空的

数据没搬，或者搬到了错误的位置。确认 `data/plugins/dsh-tavern-image/definitions.json` 大于 500 字节：

```powershell
(Get-Item "$env:USERPROFILE\.dsh\profile-data\tavern\data\plugins\dsh-tavern-image\definitions.json").Length
```

### Q：历史图列表有，但图片显示不出来

只搬了 `jobs-store.json` 没搬 `cache/`。补上：

```powershell
Copy-Item "$old\cache" "$new\cache" -Recurse -Force
```

### Q：桌面弹出 `failed to validate config file ...tools.cordis.yml`，所有插件都不见了

`data/tools/` 下有非插件目录。查一下：

```powershell
Get-ChildItem "$env:USERPROFILE\.dsh\profile-data\tavern\data\tools" -Directory |
  ForEach-Object {
    $ok = (Test-Path "$($_.FullName)\package.json") -and ((Test-Path "$($_.FullName)\lib\index.js") -or (Test-Path "$($_.FullName)\index.mjs"))
    "$($_.Name)  $(if ($ok) {'插件'} else {'不是插件 ← 要移走'})"
  }
```

把「不是插件」的目录 Move 到 `data/backups/` 下，然后完整重启。`card-updater` / `wrongbook` 显示「不是插件」是正常的，它们是数据目录，不用管。

### Q：改过世界书，但出图规则没生效

插件有进程级世界书缓存。迁移后重启一次就好。以后如果手改 `worldbook.json`，也要重启（或者从面板里点一次编辑保存）。

### Q：找不到旧插件目录

```powershell
Get-ChildItem "$env:USERPROFILE\.dsh" -Recurse -Filter definitions.json -Depth 6 -ErrorAction SilentlyContinue |
  Where-Object { $_.Length -gt 500 } | Select-Object FullName, Length
```

也可能装在 `data/plugins-backup/`、`data/plugins/` 之类的地方，全盘搜 `definitions.json` 最可靠。

### Q：`config.json` 里有密钥，安全吗

不安全。渠道 token（NovelAI、远程 ComfyUI 等）是**明文**存在 `config.json` 里的。搬文件时别截图、别发群、别传到公开仓库。

---

## 迁移完成之后

- **更新**跟着 Tavern 本体走，不用再管插件版本。
- **反馈**提到 [flizzywine/dsh-tavern](https://github.com/flizzywine/dsh-tavern/issues)。
- 本插件仓库停在 v3.0.0，不再独立发新版本。
