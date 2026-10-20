# 插件包名迁移说明

## 已发布旧 ZIP 更新器的边界

已发布的 2.9.0 ZIP 更新器只接受 `dsh-tavern-comfy` 包名。修改仓库中的新代码不会改变已经安装的更新器；旧版更新按钮不能直接安装包名为 `dsh-tavern-image` 的更新。当前目标是彻底统一到 canonical 名称，不把尚未构建和验证的 legacy bridge artifact 当作已支持迁移路径。

## 旧 ZIP 用户的一次受控手工迁移

在旧更新器不认识 canonical 包名的前提下，用户需要先做一次受控迁移，迁移完成后才能使用新版更新按钮：

1. 完整退出 DSH。备份旧插件目录和 DSH Profile，确认备份可读。
2. 准备 canonical `dsh-tavern-image` 代码目录。恢复并逐字节保留用户数据：`config.json`、`definitions.json`、`worldbook.json`、`worldbook-outfits.json`、`workflows/`、`cache/`；同时保留 `jobs-store.json`、`plans-store.json`、`backups/` 等运行数据。
3. 使用官方 CLI 将 canonical 插件登记为 `dsh-tavern-image`，并移除旧 `dsh-tavern-comfy` 别名。只有确认新登记可用后才清理旧目录；若步骤失败，使用备份恢复。
4. 启动 DSH，确认 canonical 插件加载及用户数据可读。之后再使用新版本的应用内更新按钮。

**验证结论：** 使用 tracked 的 2.9.0 实物源码，通过官方 CLI 在隔离 Profile 中完成了 canonical 2.9.1 候选登记及回退演练；依赖、bundle 和模块链接均正确，`package.json`、lockfile、`cordis.patch.yml` 三个文件的 SHA256 在回退后完全恢复。Profile patch 中 0/0/0 条目符合预期：bundles 引用包自身的 patch，包自身的 id/name 各一份。真实用户 Profile 未修改，也未启动 DSH；没有调用生图服务。该演练不表示已发布的旧 ZIP 更新器可直接跨包名更新：旧 ZIP 用户仍需先完成上述一次受控手工迁移，之后才能使用新版更新按钮。
