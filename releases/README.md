# releases — 版本归档与二进制暂存

这个目录用来**按版本**组织发布物。

## 为什么安装包不提交到版本库

| 原因 | 说明 |
|---|---|
| GitHub 单文件硬限制 | 仓库中单个文件不得超过 **100MB**，而安装包约 **114MB**，直接提交会被拒绝 |
| 仓库体积 | 二进制每次构建都变，提交进去会让仓库迅速膨胀、克隆变慢 |
| 正确做法 | 二进制上传到 **GitHub Releases**（单文件上限 2GB，可放多个附件） |

所以 `releases/*/bin/` 已被 `.gitignore` 忽略，它只是**本机的暂存目录**，
方便你上传前把产物集中到一起。

## 目录约定

```
releases/
├── README.md                 本文件
├── v0.1.0/
│   ├── RELEASE-NOTES.md      该版本的发布说明（内容与 CHANGELOG 的对应小节一致）
│   └── bin/                  安装包暂存（不提交）
│       ├── js-pet-0.1.0-setup.exe
│       ├── js-pet-0.1.0-portable.exe
│       └── .gitkeep
├── v0.1.1/                   当前版本
│   ├── RELEASE-NOTES.md
│   └── bin/
│       ├── js-pet-0.1.1-setup.exe
│       ├── js-pet-0.1.1-portable.exe
│       └── .gitkeep
└── v0.2.0/                   未来版本沿用同样结构
    ├── RELEASE-NOTES.md
    └── bin/
```

## 上传流程（手动）

1. 把构建产物复制进对应版本的 `bin/`：

   ```bash
   mkdir -p releases/v0.1.0/bin
   cp dist/js-pet-0.1.0-setup.exe dist/js-pet-0.1.0-portable.exe releases/v0.1.0/bin/
   ```

2. 打开 GitHub 仓库 → **Releases** → **Draft a new release**
3. **Choose a tag** 选择或新建 `v0.1.0`
4. 标题 `v0.1.0`，说明正文粘贴 `RELEASE-NOTES.md` 的内容
5. **Attach binaries** 上传 `bin/` 里的文件（也可直接把文件拖到上传框里）
6. **Publish release**

完整发布流程（含测试、打包、验证、打 tag）见
[发布与版本管理](../docs/06-发布与版本管理.md)。
