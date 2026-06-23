<p align="center">
  <img src="docs/app-icon.png" width="96" alt="ECHO iPhone app icon" />
</p>

<h1 align="center">ECHO iPhone</h1>

<p align="center">
  一款为 <a href="https://github.com/Moekotori/ECHO">ECHO NEXT</a> 打造的非官方 iPhone 音乐伴侣。
</p>

<p align="center">
  <strong>中文</strong> · <a href="README.en.md">English</a> · <a href="RELEASE_NOTES.md">Release Notes</a>
</p>

![ECHO iPhone ACG preview](docs/preview.svg)

> 这是一个非官方社区项目，不隶属于 ECHO NEXT 官方仓库。
>
> 如果你有版权、建议或问题反馈，可以在 [ECHO 官方 QQ 群](https://qm.qq.com/q/OdpngxJU86) 联系 @白雪ユキ。

## 这是什么

ECHO iPhone 是 ECHO NEXT 的非官方 iPhone 端。它通过 EchoLink 连接电脑端，用手机查看当前播放、控制播放、浏览曲库，并在支持时把电脑上的本地音频串流到 iPhone。

它不是独立播放器。电脑端仍负责曲库、播放队列、歌词、封面和音频信息；手机端负责控制、展示和串流。

## 主要功能

- 播放：播放 / 暂停、上一首、下一首、进度拖动、音量拖动。
- 歌词：读取桌面端歌词，支持 LRC 自动滚动和点击歌词跳转。
- 曲库：浏览电脑端曲库，搜索歌曲，筛选全部 / 可串流 / 本地。
- 串流：支持的本地音频可以从电脑串流到手机播放。
- 播放列表：在播放页打开当前队列预览。
- 音频 tag：显示 Local、可串流、WASAPI / ASIO、FLAC 48kHz/24bit、码率、时长等信息。
- 设置：选择中文 / English，选择哪些音频 tag 显示。
- 连接：支持 `echo://pair?...` 配对链接，也支持手动填写 Host、Port、Token。

## 使用前提

- 电脑端需要运行 ECHO NEXT，并开启 EchoLink。
- iPhone 和电脑需要在同一个局域网。
- Windows 防火墙需要允许 ECHO NEXT 通信。
- 手机串流取决于桌面端 stream 接口和 iOS 可播放的音频格式。
- 封面、歌词和音频 tag 取决于桌面端返回的数据。

## 本地运行

```powershell
npm install
npm run start
```

类型检查：

```powershell
npm.cmd run typecheck
```

iOS 导出检查：

```powershell
npx.cmd expo export --platform ios --output-dir build\export-check
```

## 连接电脑端

配对链接示例：

```text
echo://pair?host=192.168.1.12&port=26789&token=...
```

手动连接：

- Host：电脑局域网 IP，例如 `192.168.2.27`
- Port：默认通常是 `26789`
- Token：从 ECHO NEXT 的 EchoLink 配对界面复制

连接失败时，先检查是否同一 Wi-Fi / LAN、EchoLink 是否开启、防火墙是否放行、Host 是否填了电脑局域网 IP、iOS 是否允许本地网络权限。

## 当前使用的 EchoLink 接口

```text
GET  /echo-link/v1/status
GET  /echo-link/v1/library/tracks
GET  /echo-link/v1/library/albums
GET  /echo-link/v1/library/albums/:albumId/tracks
POST /echo-link/v1/playback/command
POST /echo-link/v1/library/tracks/:trackId/stream
GET  /echo-link/v1/library/tracks/:trackId/lyrics
```

请求头：

```text
Authorization: Bearer <token>
x-echo-link-version: 1
```

## 构建 IPA

Windows 不能直接本地构建 iOS IPA，可以用 GitHub Actions 的 macOS runner。

1. 推送仓库到 GitHub。
2. 打开 GitHub Actions。
3. 运行 `Build iOS unsigned IPA`。
4. 下载 `ECHO-iPhone-unsigned-ipa`。
5. 用 Sideloadly、AltStore、Xcode 或其他工具签名安装。

本地 Mac 构建：

```bash
bash scripts/build-unsigned-ipa-for-sideloadly.sh
```

输出：

```text
build/ios-unsigned/ECHO-iPhone-unsigned.ipa
```

### Xcode 免费 Apple ID

```bash
bash scripts/build-free-apple-id-with-xcode.sh
```

脚本会打开生成的 Xcode workspace。选择自己的 Apple ID Team，连接 iPhone，然后 Run。

## 资源说明

- `docs/app-icon.png` 是 README 和 Expo 当前共用的应用图标。
- `docs/app-icon.svg` 是同风格的轻量展示版图标。
- `docs/preview.svg` 是 README 顶部 ACG 风格功能预览图。
- `Assets.car` 可以放在仓库根目录，未签名 IPA 脚本会在打包时复制进最终 `.app`。
- 歌曲封面从 EchoLink artwork URL 加载；如果远程图片加载失败，移动端会保留稳定封面或显示 ECHO 占位。

## 项目结构

```text
App.tsx                         主界面、播放控制、歌词和串流逻辑
app.json                        Expo iOS 配置
src/echoLink/client.ts          EchoLink HTTP 客户端
src/echoLink/types.ts           移动端 EchoLink 类型
src/echoLink/pairing.ts         配对 URI 解析
src/storage/connectionStore.ts  本地连接信息保存
scripts/                        iOS 构建辅助脚本
.github/workflows/              未签名 IPA 工作流
docs/                           图标、预览图和 README 资产
```

## 上传清单

建议上传：

- `.github/workflows/build-ios-unsigned.yml`
- `.gitattributes`
- `.gitignore`
- `app.json`
- `App.tsx`
- `Assets.car`
- `package.json`
- `package-lock.json`
- `README.md`
- `README.en.md`
- `RELEASE_NOTES.md`
- `tsconfig.json`
- `docs/`
- `scripts/`
- `src/`

不要上传：

- `node_modules/`
- `build/`
- 生成的 `.ipa` 文件

## Release 更新日志

最新更新请看 [RELEASE_NOTES.md](RELEASE_NOTES.md)。
