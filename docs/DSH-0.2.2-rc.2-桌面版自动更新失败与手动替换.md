# DSH 0.2.2-rc.2 桌面版：自动更新「装完就退、版本没变」

> 2026-11-12 实测。桌面版自动更新连续失败四次，根因是安装目录被句柄占用（`MoveFileExW` error 32）。

## 一、现象

```
点「更新」→ 进度条跑完 → 安装器自动退出 → 重新打开 DSH → 还是旧版
重启计算机 → 再点更新 → 同样结果
```

用户侧看法是「更新没生效」，实际是**每次都在同一个环节失败并回滚**。

## 二、取证：读安装器自己的日志

不要猜，Electron updater 会把每次失败写进 `installer-logs`：

```powershell
$up = "$env:LOCALAPPDATA\@deepseek-aidsh-desktop-updater"
Get-ChildItem "$up\installer-logs" | Sort-Object LastWriteTime -Descending | Select-Object -First 3
type (Get-ChildItem "$up\installer-logs\*" | Sort-Object LastWriteTime -Descending | Select -First 1).FullName
```

实测四次失败（09:47:33 / 09:58:08 / 10:04:25 …），内容一模一样：

```
Operation: MoveFileExW
Windows error: 32（另一个程序正在使用此文件，进程无法访问）
Source:      C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness
Destination: C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness.old-{882C82AE-...}
Restoration error: 0
Attempts:
backup: Windows error: 32   ×10
```

## 三、根因

自动更新的顺序是：

```
① 把旧目录【重命名】为 DeepSeek Harness.old-{GUID}
② 解包新版本到原路径
③ 删除 .old 目录
```

**第 ① 步需要一个「能重命名目录」的窗口**。那一刻只要有句柄占着目录中任一文件，重命名就失败：

- 上一次没退干净的 Electron 子进程
- 杀毒软件 / Windows Search 索引服务正在扫这个目录
- 资源管理器打开了该目录

**重试 10 次结果都一样**，然后安装器回滚，用户看到的就是「装完自己退了」。

## 四、诊断（两句）

```powershell
# ① 还有没有进程占着
taskkill /IM "DeepSeek Harness.exe" /F /T

# ② 目录能不能改名（能 ⇒ 句柄已释放，可以手动装）
python -c "import os; os.rename(r'%LOCALAPPDATA%\Programs\DeepSeek Harness', r'%LOCALAPPDATA%\Programs\DeepSeek Harness.test'); os.rename(r'%LOCALAPPDATA%\Programs\DeepSeek Harness.test', r'%LOCALAPPDATA%\Programs\DeepSeek Harness'); print('MOVABLE')"
```

- 输出 `MOVABLE` → 手动装能成功
- 报 `WinError 32 / PermissionError` → 还有东西占着，先找出来杀掉，或关掉杀软/索引再试

## 五、手动替换（不用等官方修）

安装包早就下好了，在 `pending` 里：

```
%LOCALAPPDATA%\@deepseek-aidsh-desktop-updater\pending\
  deepseek-harness-0.2.2-rc.2-win-x64.exe    285 MB
  update-info.json                            含 sha512
```

步骤：

```powershell
# ① 旧目录改名备份（不要删 —— 出问题能立刻换回来）
Rename-Item "$env:LOCALAPPDATA\Programs\DeepSeek Harness" "DeepSeek Harness.old-backup"

# ② 跑 pending 里的安装包（/S = 静默安装）
$exe = Get-ChildItem "$env:LOCALAPPDATA\@deepseek-aidsh-desktop-updater\pending\*.exe" | Select -First 1
Start-Process $exe.FullName -ArgumentList '/S' -Wait

# ③ 验版本（见下节，别看 version 文件）
```

实测：静默安装返回码 `0`，耗时约 25 秒。

## 六、⚠️ 版本号别看 `version` 文件

```
%LOCALAPPDATA%\Programs\DeepSeek Harness\version   →  44.7.0
```

**44.7.0 是 Electron 的版本，不是 DSH 的。**

DSH 版本看主程序的文件版本信息：

```powershell
(Get-Item "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe").VersionInfo |
  Select-Object FileVersion, ProductVersion
# 期望：FileVersion = 0.2.2-rc.2
```

本会话就因为读了 `version` 文件，把「装成功了」误判成「还是老的」，多绕了一圈。

## 七、验收

```powershell
# ① 桌面版能打开，版本对
(Get-Item "...\DeepSeek Harness.exe").VersionInfo.FileVersion      # 0.2.2-rc.2

# ② CLI 版本与桌面版一致
dsh --version                                                        # 0.2.2-rc.2
```

**两边一致才算升级干净收尾。**

旧目录 `DeepSeek Harness.old-backup`（约 300 MB）先留着，观察几天确认无问题再删。

## 八、版本基线

```
升级前    0.2.2-rc.1
升级后    0.2.2-rc.2
平台      Windows 10.0.26300
安装路径  %LOCALAPPDATA%\Programs\DeepSeek Harness
```

## 九、走过的弯路

| 查过什么 | 结论 | 为什么是弯路 |
|---|---|---|
| 进程列表有没有 DSH | 没有 | 占目录的不一定是 DSH 进程，杀软/索引也会有句柄 |
| `taskkill /IM "DeepSeek Harness.exe"` | 报「没有找到进程」 | 说明进程早退了，占用在别处 —— 这句本身就是有效判据 |
| 读 `version` 文件判断版本 | 显示 44.7.0，误以为没升级 | 那是 Electron 版本，不是 DSH 版本；应读 exe 的 FileVersion |
| 让用户重启计算机再试 | 无效 | 重启只清了进程，句柄占用原因（杀软/索引）仍在，自动更新照样失败 |
| 反复点「更新」 | 无效 | 每次都在第①步失败并回滚，重试次数多少都不影响 |

**最有价值的一步：去看 `installer-logs`。** 那里直接把 `MoveFileExW` / `error 32` 写出来了，比任何猜测都快。
