# sily

サンプリングからの音楽構築に特化した DAW のプロトタイプ。音源を取り込み、チョップして、パッドで叩いてループを作る。

## 開発

Rust（`wasm32-wasip1` ターゲット）と pnpm が必要。

```sh
rustup target add wasm32-wasip1
cd web
pnpm install
pnpm dev
```

- `cargo test -p sily-core`: コアのテスト
- `pnpm test`: Web 側のテスト
- `pnpm build`: WASM と Web をビルドして `web/dist` に出力
- `npx wrangler deploy`: Cloudflare Workers にデプロイ（リポジトリルートで実行）

## 操作

| キー | 動作 |
| --- | --- |
| `1234` `QWER` `ASDF` `ZXCV` | パッド（MPC と同じく左下が 1） |
| `P` | ソースを試聴 |
| `M` | 試聴中の位置にマーカーを打つ |
| `Space` | パターン再生／停止 |
| `Enter` | 録音 |
| `Tab` | 鍵盤モード（選択中のパッドを音階で弾く） |
