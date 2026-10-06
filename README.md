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

音源をドロップするか録音を止めると、そこから鳴り出すまで自動で進む。BPM を推定し、トランジェントで切り、CLAP で各スライスの役割を聞き分けて、キットを組む（切り口がきれいなものを優先し、似た音は重ねない）。うわもの用の3パッドには拍に沿って切った1小節か半小節のフレーズを載せ、パターン候補を4つ作って1つ目を鳴らす。スタイルが「BPM に合わせる」なら、BPM に合うスタイルを候補に振り分ける（88 ならブーンバップとヨレ、124 なら4つ打ちとブレイクビーツ、96 ならレゲトン、132 なら UK ガラージ、140 ならジャージークラブ、145 ならトラップ、174 ならドラムンベース）。

| キー | 動作 |
| --- | --- |
| `1234` `QWER` `ASDF` `ZXCV` | パッド（MPC と同じく左下が 1） |
| `P` | ソースを試聴 |
| `M` | 試聴中の位置にマーカーを打つ |
| `Space` | パターン再生／停止 |
| `Enter` | 録音 |
| `Cmd+Z` / `Shift+Cmd+Z` | 取り消し／やり直し |
| `G` | 自動で組む（候補を4つ出す） |
| `L` | ラベル付け（スライスを順に聴いて、`K` キック・`S` スネア・`H` ハット閉・`O` ハット開・`E` パーカッション・`B` ベース・`U` うわもので付ける。`Enter` で今のラベルのまま確定、`.` で前のスライスと同じラベル、`Backspace` で前のスライスとつなげる、`←` `→` で移動） |
| `Tab` | 鍵盤モード（選択中のパッドを音階で弾く。録音中ならピッチ付きで入る） |

パターン上のノートはホイールで半音ずつ上下する。

「共有」でプロジェクトをリンクにできる（メールのワンタイム PIN でログインが要る。1日3つ、手元に20個まで）。元の音源は、パッドが一番多く収まる15秒に切り詰め、外れたスライスは単独の音として入れる。リンクを開いた人はログインなしで再生とパッドを試せて、「自分のプロジェクトとして保存」で手元に複製できる。

パターンは A〜H の8つまで持てる。再生中に切り替えると、その小節の終わりで切り替わる。「曲」にパターンを並べて「曲で再生」にすると、並べた順に通して鳴り、WAV 書き出しも曲全体になる。行頭の M / S でパッドごとにミュート／ソロ。

## 分類器の学習

スライスの役割（kick / snare / closed_hat / open_hat / perc / bass / upper の7つ）は、まず Rust の特徴量のモデル（`web/src/classify/model.json`）で仮に判定し、裏で CLAP の音声埋め込みに同じ特徴量をつなげ、ロジスティック回帰をかけたもの（`web/src/classify/probe.json`）で置き換える。CLAP は WebGPU があれば fp16、なければ WASM の q8 で動かす。

```sh
echo "FREESOUND_API_KEY=..." > .env
uv run tools/train/fetch.py --per-class 300
cargo build -p sily-tools --release
uv run tools/train/pull.py
uv run tools/train/train.py tmp/train/freesound
uv run tools/train/probe.py tmp/train/freesound
```

`probe.py` の埋め込みはブラウザと同じ transformers.js のモデルを Node で動かして取る（`web/scripts/embed-audio.ts`、ffmpeg が要る）。結果は `tmp/train/clap-cache-fp32.jsonl` にキャッシュされる。

ラベルを直すと、そのスライスの音声が送られる。`pnpm dev` では `tmp/train/corrections/<ラベル>/` に直接保存され、本番では D1 と R2 に溜まる（書き込みは Cloudflare Access でログインした本人だけ）。`pull.py` は本番の分を同じフォルダに取ってくる。`train.py` はこのフォルダがあれば自動で学習に含める。

録音5本に1本は評価用に取り分けられ（ラベル付けの画面の「この録音を評価用にする」で、狙った録音を評価用にもできる）、そのスライスは `tmp/train/eval/<ラベル>/` に入る（`split` を記録する前に送られた分は学習用）。`train.py` と `probe.py` はここを学習に使わず、学習後にこの上での精度を出す。`probe.py` は実際の録音から切った音を `--real-weight` 倍（既定 10）の重みで学習する。

手持ちのドラム音源からも集められる。`render.py midi` が GM のドラムを1発ずつ鳴らす MIDI を作るので、DAW のテンポを 120 にして音源に鳴らし、小節1の頭から WAV に書き出し、`render.py split` で切ると `tmp/train/render/<ラベル>/` に入り、これも学習に含まれる。

```sh
uv run tools/train/render.py midi tmp/render/hits.mid
uv run tools/train/render.py split tmp/render/<キット名>.wav
```

GM 配列でないキットは `render.py sheet <WAV>` で鳴った音だけを詰めた `<キット名>-sheet.wav` を作り、sily に読み込んでラベル付けモードで付ける。同じ音が強さ違いで3発ずつ並ぶので、2発目からは `.`（前と同じ）で進められる。
