# Picture Talk PECS v2

PTP | Picture Talk PECS v2 開発管理

特別支援学校で、カードを相手に渡して要求を伝える学習を支えるWebアプリ。
旧 [Picture-Talk-PECS](https://github.com/kamekamelab/Picture-Talk-PECS) とは独立して開発します。

## 現在の範囲（0.2.0）

- Phase 1：カードを取る → 渡す → 相手が受け取りを確認
- Phase 4の基本：ことばのカードを並べ、最後に「ください」を置く日本語のSentence Strip。取り消し・並べ替え、文全体の交換、語順を保持した記録
- 写真・イラスト・文字・マーク・カテゴリのカード編集
- 先生用画面と生徒用画面の分離、長押しと任意のPIN
- 交換ごとの日時・カード・呼び名・支援の有無の記録、CSV出力
- IndexedDBによる保存、JSONバックアップと内容確認付き復元
- Service Workerによるオフライン起動、ホーム画面追加用PWA

**Phase 2・3、印刷、ドラッグ、要求表現の編集は未実装です。** Phase 4は「ください」の文をタップで作る基本機能に限ります。[確認済み仕様](docs/DECISIONS.md)と[開発計画](docs/ROADMAP.md)を参照。
PECSの考え方を参考にした教育用アプリで、正式な研修や個別の指導計画を置き換えるものではありません。特にPhase 1・2では紙カードによる実際の交換との併用を想定します。

## ローカル起動

Node.js 22以降。外部パッケージのインストールは不要です。

このMacでは [scripts/dev.command](scripts/dev.command) を実行すると、同梱Nodeを検出して起動できます。ターミナルからは `./scripts/dev.command`。

```sh
npm run dev
```

http://127.0.0.1:4175/ を開きます。停止はCtrl+C。
`node` がPATHにない場合は、Codexの同梱Nodeの絶対パスで `scripts/serve.mjs` を実行できます。
対応ブラウザーはWeb Locks・IndexedDB・Service Worker・dialog・createImageBitmapに対応した新しいSafari / Chromeです。

```sh
npm run check
```

このMacの同梱Nodeにはnpmがないため、検証は同梱Nodeの絶対パスで `--test tests/*.test.mjs` と `--check dist/app.js` 等を実行します。

保存形式はv2です。0.1.0のv1データ・バックアップを読み込むとPhase 1として引き継ぎます。新版で保存したデータは旧アプリ版0.1.0では開けません。更新前のバックアップを保持してください。

## 保存とプライバシー

- 写真・記録はこの端末・ブラウザー・配信元のIndexedDB内。自動同期や外部解析はありません。
- 画像は端末内で最大800pxに縮小・PNG化し、位置情報等のメタデータを除去。大きいPNGは白背景のJPEGに変換します。JPEG・PNG・WebP・GIF（静止画）を受け付けます。
- データ総量は24MBまで、復元ファイルは25MBまで。常に復元できるバックアップを書き出せるように上限を設けています。
- 実名は不要。任意の呼び名を使用します。初期版は1つの学習設定を切り替える構成です。
- PINは誤操作防止です。暗号化・厳密な本人認証ではありません。再起動後もPINが必要です。
- ブラウザーデータ削除・端末故障に備えてバックアップを保存してください。ファイルは暗号化されません。
- PINを忘れた場合は、PINが分かるバックアップまたはPIN設定前のバックアップを別のブラウザー環境に復元してください。データの削除は復旧策ではありません。
- 同時に複数のタブで開けないようWeb Locksを使用し、古い状態での上書きを防ぎます。
- インターネット利用時にはアプリ配信元への通信が発生します。GitHub Pages公開時はGitHubによるIPログがあります。
- 実際の児童生徒データをGit、Issue、PRに登録しないでください。

## オフラインと更新

初回の読み込み完了後、「オフライン準備済み」を確認します。カード画像はIndexedDB、プログラム類は専用キャッシュに保存します。新しいバージョンは開いている画面を強制更新せず、すべてのタブを閉じて開き直すと適用されます。更新時は `dist/sw.js` のキャッシュ名も変更してください。

ローカルPCのlocalhostはiPadから開けません。iPad実機では、後の公開工程でGitHub Pages等のHTTPS配信先を用意して検証します。通常のLAN内HTTP配信ではPWAの検証はできません。

## GitHub Pages（未公開）

`dist/` 以下をそのまま配信できる静的構成です。サーバーDBやAPIは不要です。
公開工程でGitHub Actionsによる `dist/` のアップロードとPagesへのデプロイを追加する予定です。
アセット・Service Worker・manifestは相対URLで、リポジトリ配下のURLに対応しています。
初期版ではPagesを有効化していません。

## 資料

- [設計](docs/DESIGN.md)
- [会話で確認した仕様](docs/DECISIONS.md)
- [開発計画と完了条件](docs/ROADMAP.md)
- [検証記録](docs/VALIDATION.md)
- [GitHub接続状況](docs/GITHUB.md)
