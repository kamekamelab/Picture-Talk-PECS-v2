# GitHubとPages

2026-10-29、iPad用HTTPSテストURLの準備依頼を受け、v2のPagesを有効化。

- origin：https://github.com/kamekamelab/Picture-Talk-PECS-v2.git
- 公開URL：https://kamekamelab.github.io/Picture-Talk-PECS-v2/
- ブランチ：main。既存のPUBLIC設定を維持。
- `.github/workflows/pages.yml`：構文・自動テストが成功した場合だけ、`dist/`を公開する。
- Gitにはプログラム・自作アイコン・テスト・資料のみ。端末内の写真・名前・学習記録・バックアップは送らない。
- 旧`Picture-Talk-PECS`リポジトリは変更しない。

## iPadでの確認

Safariで公開URLを開き、「オフライン準備済み」を確認して共有メニューからホーム画面に追加。カード選択・文づくり・読み上げ・配置編集・機内モード再起動・バックアップ保存復元・実寸印刷を確認する。

データはブラウザーの保存場所ごとに分かれる。localhost版や別端末のカードは自動同期されない。必要な場合はバックアップファイルで移す。GitHubへの送信は行わない。

## 更新

ローカルで開発・検証後、mainへpushする。配信対象はdistのみ。アプリのコードを変えたときはService Workerのキャッシュ名も更新する。既存の画面をすべて閉じて開き直すと新しい版が適用される。
