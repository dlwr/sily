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
| `Cmd+Z` / `Shift+Cmd+Z` | 取り消し／やり直し |
| `G` | 自動で組む（候補を4つ出す） |
| `L` | ラベル付け（スライスを順に聴いて、`K` キック・`S` スネアなどのキーで付ける。`Enter` で今のラベルのまま確定、`.` で前のスライスと同じラベル、`Backspace` で前のスライスとつなげる、`←` `→` で移動） |
| `Tab` | 鍵盤モード（選択中のパッドを音階で弾く。録音中ならピッチ付きで入る） |

パターン上のノートはホイールで半音ずつ上下する。

パターンは A〜H の8つまで持てる。再生中に切り替えると、その小節の終わりで切り替わる。「曲」にパターンを並べて「曲で再生」にすると、並べた順に通して鳴り、WAV 書き出しも曲全体になる。行頭の M / S でパッドごとにミュート／ソロ。

## 分類器の学習

スライスの種類（キック、スネアなど）は、学習済みモデル（`web/src/classify/model.json`）があればそれで、なければルールで判定する。

```sh
echo "FREESOUND_API_KEY=..." > .env
uv run tools/train/fetch.py --per-class 300
cargo build -p sily-tools --release
uv run tools/train/pull.py
uv run tools/train/train.py tmp/train/freesound
```

ラベルを直すと、そのスライスの音声が送られる。`pnpm dev` では `tmp/train/corrections/<ラベル>/` に直接保存され、本番では D1 と R2 に溜まる（書き込みは Cloudflare Access でログインした本人だけ）。`pull.py` は本番の分を同じフォルダに取ってくる。`train.py` はこのフォルダがあれば自動で学習に含める。

手持ちのドラム音源からも集められる。`render.py midi` が GM のドラムを1発ずつ鳴らす MIDI を作るので、DAW のテンポを 120 にして音源に鳴らし、小節1の頭から WAV に書き出し、`render.py split` で切ると `tmp/train/render/<ラベル>/` に入り、これも学習に含まれる。

```sh
uv run tools/train/render.py midi tmp/render/hits.mid
uv run tools/train/render.py split tmp/render/<キット名>.wav
```

GM 配列でないキットは `render.py sheet <WAV>` で鳴った音だけを詰めた `<キット名>-sheet.wav` を作り、sily に読み込んでラベル付けモードで付ける。同じ音が強さ違いで3発ずつ並ぶので、2発目からは `.`（前と同じ）で進められる。
