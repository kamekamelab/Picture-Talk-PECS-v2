# GitHub接続状況

## 設定済み

- ローカル：`picture-talk-pecs-v2`
- ブランチ：`main`
- origin：`https://github.com/kamekamelab/Picture-Talk-PECS-v2.git`
- 開発対象はv2のみ。旧 `Picture-Talk-PECS` にremote・コミット・ファイル変更を行わない。

GitHub確認時、このv2リポジトリは既に存在し、PUBLICで中身は空だった。リポジトリ作成・公開範囲変更・初push・Pages有効化は行っていない。ローカルGitに成果を保存し、origin接続先を設定した段階。

## 非公開で開発を続ける場合の具体案

1. 既存の空のv2リポジトリを非公開へ変更し、その同じURLを使う。
2. または `Picture-Talk-PECS-v2-dev` を新規の非公開リポジトリとして用意し、originをそちらへ変更する。

推奨は1。空リポジトリなので、既存のコードや履歴を移す必要がない。どちらも現在のローカル実装をそのまま利用できる。公開範囲の操作は未実行。

現在のPUBLICリポジトリへコードを送る方針になった場合も、送る対象はプログラム・テスト・設計資料のみ。カード画像・記録はブラウザーのIndexedDB内にあり、バックアップ類は `.gitignore` の対象。公開前に `git ls-files` を確認する。

## Pages

GitHubへのコード同期とアプリのPages公開は別の工程。初期版はローカルのみ。Pagesデプロイ用workflowはまだ追加していない。
