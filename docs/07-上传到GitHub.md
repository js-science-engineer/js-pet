# 如何把本文件夹上传到 GitHub

本文件夹已经是**可以直接上传的干净版本库**（已剔除第三方素材、构建产物与个人数据）。
下面是最省事的做法。

## 一、先确认不需要再改什么

| 已处理 | 说明 |
|---|---|
| 已删除第三方 IP 素材 | 早期开发时用于自测的第三方角色图片、以及依赖它们的演示页一律没有带过来 |
| 已排除构建产物 | `node_modules/`、`dist/`、临时调试目录都不在，`.gitignore` 也已写好 |
| 已排除个人数据 | 桌面宠物的运行数据（`%APPDATA%/js-pet`）从来不在这里 |
| 已归档安装包 | 放在 `releases/v0.1.0/bin/`，**不会**被提交（超过 GitHub 100MB 限制），改传 Releases |
| 已补法律文件 | `LICENSE`（MIT）、`CHANGELOG.md`、`.gitattributes` |

## 二、本地建库并提交（可选，若你还没做）

在当前文件夹里执行：

```bash
cd "C:/Users/Lenovo/Desktop/js-pet(2)"
git init
git branch -m main
git add -A
git commit -m "初始提交：js-pet v0.1.0 桌面电子宠物"
```

确认一下提交内容里没有大文件（应该只有几百 KB ~ 十几 MB 的源码与素材）：

```bash
git ls-files | wc -l          # 文件数量
git ls-files | grep -E "\.exe$|node_modules"   # 应该没有任何输出
```

## 三、推到 GitHub

### 方式一：用网页建库后推送（最直观）

1. 打开 https://github.com/new
2. **Repository name** 填 `js-pet`
3. 选择 **Public**（或 Private，看你意愿）
4. **不要**勾选 "Add a README file" / ".gitignore" / "license"（我们已经有了，勾了会冲突）
5. 点 **Create repository**
6. 回到本地终端，按页面提示执行：

```bash
git remote add origin https://github.com/<你的用户名>/js-pet.git
git push -u origin main
```

### 方式二：用 GitHub CLI（更快）

```bash
gh auth login                 # 首次需要登录
gh repo create js-pet --public --source=. --push
```

## 四、上传安装包到 Releases

仓库里只放源码，安装包走 Releases：

1. 仓库页面 → **Releases** → **Draft a new release**
2. **Choose a tag** 输入 `v0.1.0` → 点 "Create new tag"
3. 标题填 `v0.1.0`
4. 说明正文复制 `releases/v0.1.0/RELEASE-NOTES.md` 的内容粘贴进去
5. 把 `releases/v0.1.0/bin/` 里的两个 exe **拖进上传框**
6. **Publish release**

详细流程与注意事项见 [发布与版本管理](06-发布与版本管理.md)。

## 五、上传后自检

- [ ] 仓库首页能正常显示 `README.md`，图标和形象预览图能加载
- [ ] 代码文件里没有第三方 IP 素材（`git ls-files` 搜不到相关资源）
- [ ] Releases 页面下载链接可用，文件名与文档一致
- [ ] 从零克隆一份并跑通：

  ```bash
  git clone https://github.com/<你的用户名>/js-pet.git
  cd js-pet && npm install && npm test
  ```

## 六、以后的更新怎么推

```bash
git add -A
git commit -m "修复 xxx / 新增 xxx"
git push
```

发新版本时：改 `package.json` 版本号 → 更新 `CHANGELOG.md` → 打 tag → 建 Release，见
[发布与版本管理](06-发布与版本管理.md)。
