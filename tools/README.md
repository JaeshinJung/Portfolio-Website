# spritify.py — AI 픽셀아트 초안을 게임 스프라이트로 변환

## 이 도구가 필요한 이유

Gemini / "Nano Banana" 같은 text-to-image 모델에 "픽셀아트, 투명 배경, 지정 팔레트"를
요청해도 실제 결과물은 거의 항상 이렇게 나옵니다.

- 경계가 부드럽게 번진 anti-aliasing (진짜 픽셀 그리드가 아님)
- 요청한 팔레트를 무시하고 비슷한 색을 새로 만들어냄 (`#E8E4F0` 대신 `#E7E3EF` 등)
- 투명 배경 대신 불투명한 어두운 배경, 또는 체크무늬처럼 보이는 배경
- 은근한 드롭 섀도우

이걸 손으로 고치면 매번 결과가 달라지고, 사이트 전체의 색 통일성이 깨집니다.
그래서 **팔레트 스냅을 자동화**했습니다. 모델이 팔레트를 지켜주기를 기대하는 대신,
후처리에서 모든 불투명 픽셀을 `palette.txt`의 가장 가까운 색으로 **결정론적으로**
강제 변환합니다. 같은 입력이면 항상 같은 출력이 나오고, 출력에는 팔레트 색 외의
색이 존재할 수 없습니다.

## ⚠️ 이미지 생성 프롬프트는 배경을 `#FF00FF`(마젠타)로 요청해야 합니다

**투명 배경이나 어두운 배경을 요청하지 마세요. 반드시 "solid `#FF00FF` magenta
background"를 요청하세요.**

이유는 이렇습니다. 배경 제거(key-out)는 테두리에서 안쪽으로 번져 들어가는
연결 영역 채우기이고, `--fuzz` 허용 오차(기본 0.12 → 가중 RGB 거리 30.6) 안의
색을 배경으로 봅니다. 그런데 목표 팔레트 자체가 `#16121C`와 `#2E2540`을 함께
가지고 있고, 이 둘의 가중 거리는 **32.5**밖에 안 됩니다.

즉 **어두운 배경 위의 어두운 생물은 원리적으로 분리할 수 없습니다.**
실제 테스트에서 몸 색이 배경과 거리 27.9였던 생물은 허용 오차 안에 들어가
몸통이 배경과 함께 지워졌고, 167px여야 할 스프라이트가 89px로 나왔습니다.
`--fuzz`를 조절해서 해결되는 문제가 아닙니다. 낮추면 배경이 남고, 높이면
몸통이 더 지워집니다.

마젠타 `#FF00FF`는 안전합니다. 팔레트의 **모든** 색에서 가중 거리 76 이상
떨어져 있고(가장 가까운 `#FF4D6D`이 76.4), 생물 몸 색으로 등장할 일이 없습니다.
그래서 `--bg`의 기본값이 `FF00FF`이며, 도구는 마젠타가 실제로 있는지
**검사한 뒤 없으면 실패**합니다 (조용히 넘어가지 않습니다).

프롬프트 예시 문구:

```
... pixel art, flat colors, no anti-aliasing, no drop shadow,
solid #FF00FF magenta background (pure chroma key, do not use transparency),
do NOT draw a transparency checkerboard pattern, no watermark, no signature,
6 creatures in one horizontal row with clear empty space between them ...
```

**`do NOT draw a transparency checkerboard pattern`를 반드시 넣으세요.** "투명 배경"을
요청하면 모델이 투명하게 두는 대신 **이미지 편집기가 투명을 표시할 때 쓰는 회색
체크무늬를 그림으로 그려버리는** 실패가 실제로 발생했습니다 (아래
[체크무늬를 그려버린 이미지](#체크무늬를-그려버린-이미지-painted-checkerboard) 참고).
이 경우 후처리로는 복구가 **불가능**하고 재생성만이 답입니다.

## 사전 준비 (Pillow 설치)

이 도구는 Python 표준 라이브러리 + Pillow만 사용합니다.
이 머신에는 ImageMagick이 없고 Pillow도 없었으므로 다음으로 설치했습니다.

```bash
python3 -m pip install --user Pillow
```

확인:

```bash
python3 -c "import PIL; print(PIL.__version__)"
```

> `sips`(macOS 기본 도구)는 사용하지 않습니다. 팔레트 리맵도, 신뢰할 수 있는
> nearest-neighbor 축소도 불가능하기 때문입니다.

## 사용법

리포지토리 루트에서 실행합니다.

```bash
# 1) 스프라이트 시트 (생물 6종이 가로로 한 줄)
python3 tools/spritify.py sheet <input.png> \
  --names stack,highlights,role,learned,demo,repo --size 64

# 2) 보스 프레임 (단일 피사체)
python3 tools/spritify.py single <input.png> --name boss-frame --size 128x72

# 3) 포털 (단일 피사체)
python3 tools/spritify.py single <input.png> --name portal --size 64x96
```

`sheet` 모드는 `--names`에 준 이름 앞에 `entity-`를 붙여 저장합니다.

```
public/assets/sprites/entity-stack.png
public/assets/sprites/entity-highlights.png
public/assets/sprites/entity-role.png
public/assets/sprites/entity-learned.png
public/assets/sprites/entity-demo.png
public/assets/sprites/entity-repo.png
```

`single` 모드는 `--name`을 그대로 사용합니다 (`boss-frame.png`, `portal.png`).

### 주요 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--dry-run` | off | 파일을 쓰지 않고, 감지된 크기와 팔레트 히스토그램만 출력 |
| `--out-dir` | `public/assets/sprites` | 출력 폴더 |
| `--force` | off | 기존 파일 덮어쓰기 (없으면 덮어쓰기를 거부하고 실패) |
| `--palette` | `tools/palette.txt` | 팔레트 파일 경로 |
| `--bg` | `FF00FF` | 기대하는 배경색(hex) / `auto`(모서리 샘플링) / `none`(키아웃 생략) |
| `--fuzz` | `0.12` | 배경색 판정 허용 오차 (RGB 거리 범위 대비 비율) |
| `--alpha-cut` | `128` | 이 값보다 낮은 알파는 완전 투명, 나머지는 알파 255 |
| `--strict` | off | 스프라이트 크기 편차 경고를 에러로 취급 (0이 아닌 종료 코드, 아무것도 쓰지 않음) |
| `--min-gap` | `4` | 이보다 좁은 빈 열 구간은 스프라이트를 나누지 않음 (sheet 전용) |
| `--min-width` | `8` | 이보다 좁은 덩어리는 노이즈로 버림 (sheet 전용) |
| `--crop` | 없음 | 입력을 `L,T,R,B` 픽셀 박스로 먼저 잘라냄 (오른쪽/아래는 exclusive). 휴리스틱이 못 잡는 영역을 손으로 제거하는 탈출구 |
| `--row-min-gap` | `16` | 이보다 좁은 빈 행 구간은 행 밴드를 나누지 않음 (워터마크 판정용) |
| `--outlier-max-share` | `0.02` | 메인 행 밴드의 불투명 픽셀 수 대비 이 비율보다 작은 행 밴드는 생성기 노이즈로 보고 제거 |
| `--keep-outliers` | off | 행 밴드 이상치 제거를 아예 끔 (워터마크가 그대로 남음) |
| `--min-area` | `0.01` | 이보다 작은 8-연결 불투명 덩어리(component)를 제거. **1 미만이면 가장 큰 덩어리 대비 비율**(0.01 = 1%), **1 이상이면 절대 픽셀 수** |
| `--keep-specks` | off | 덩어리 크기 필터를 아예 끔 (워터마크 잔여물이 그대로 남음) |
| `--pad` | `0` | 스프라이트를 `--size` 박스에 맞춘 **뒤** 사방에 완전 투명 픽셀 N개를 추가. 스케일은 바뀌지 않음 (`--size 64x64 --pad 2` → **68×68** 파일) |

**먼저 `--dry-run`으로 확인한 뒤 실제 실행하는 것을 권장합니다.**
`--dry-run --strict`로 먼저 검사하고, 통과하면 실제 실행하는 흐름이 가장 안전합니다.

### `--bg` 세 가지 모드

| 값 | 동작 |
| --- | --- |
| hex (예: `FF00FF`, 기본값) | 그 색을 배경으로 확정하고 테두리에서 채워 들어갑니다. 모서리 색은 샘플링하지 않습니다. 그 색이 이미지의 5% 미만이면 **실패**합니다. 키아웃 후에는 팔레트의 어떤 색보다 배경색에 더 가까운 픽셀(= 블렌딩된 마젠타 후광)을 추가로 제거합니다. |
| `auto` | 예전 동작. 네 모서리 색을 평균 내어 배경색을 추정합니다. 모서리 색이 서로 다르면 키아웃을 건너뜁니다. |
| `none` | 키아웃을 아예 하지 않고 입력의 알파를 그대로 신뢰합니다. 이미 투명 배경인 PNG를 넣을 때 사용합니다. |

`--bg`에 팔레트 색과 가중 거리 40 미만으로 가까운 색을 주면 경고가 나옵니다.
이미지 20장을 그 배경으로 만들어버리기 전에 알려주는 장치입니다.

```
warning: background #2E2540 is only 0.0 (weighted RGB) from palette color #2E2540.
  That is below the safe distance 40: the key-out may eat part of the
  subject. Pick a background far from every palette color (#FF00FF is the default).
```

## 입력 이미지 조건

- **시트**: 생물 6종이 **가로 한 줄**, 모두 같은 스케일, 그리고 서로 사이에
  **완전히 빈 세로 공간**이 있어야 합니다. 다리·꼬리·이펙트가 옆 생물과 닿거나
  겹치면 슬라이스가 실패합니다.
- **단일**: 피사체 하나만 중앙에 있는 이미지.
- 배경은 **불투명한 단색 `#FF00FF` 마젠타**여야 합니다 (위 경고 섹션 참고).
  이미 투명 배경인 이미지라면 `--bg none`, 다른 단색 배경이면 `--bg <hex>`,
  배경색을 모르겠으면 `--bg auto`를 쓰세요.

## 출력 로그 읽는 법

스프라이트마다 원본 x 범위, 트림 후 크기, 최종 크기, 그리고 **팔레트
히스토그램**(팔레트 색별 픽셀 수)을 출력합니다. 히스토그램이 검증 수단입니다.

- 한 색이 95% 이상을 차지하면 → 입력이 잘못되었을 가능성이 높습니다
  (배경 제거 실패, 대비 부족, 또는 몸 색이 배경색과 유사).
- 예상한 색이 아예 안 나오면 → 모델이 그 색을 쓰지 않았거나, 다른 팔레트 색으로
  스냅된 것입니다.

## "expected background not found"가 났을 때

```
error: expected background #FF00FF not found in this image.
  only 0 px (0.00%) are within weighted distance 30.6 of it, need >= 5%.
  sampled corner colors: (22,18,28), (22,18,28), (22,18,28), (22,18,28)
  Re-generate the image with a solid #FF00FF background, or pass
  --bg auto (sample the corners, the old behavior), --bg <hex> for a
  different background color, or --bg none to trust the existing alpha.
```

기대한 배경색이 이미지에 없다는 뜻입니다. **여기서 도구가 모서리 샘플링으로
조용히 넘어가지 않는 것이 핵심입니다.** 원래 실패(89px 스프라이트)가 눈에
띄지 않은 이유가 바로 그 조용한 fallback이었습니다.

대응 순서:

1. **가장 좋은 방법**: 프롬프트에 `solid #FF00FF magenta background`를 넣어
   이미지를 다시 생성합니다. 특히 생물이 어두운 색이면 이 방법뿐입니다.
2. 출력된 `sampled corner colors`가 전부 같은 색이고 그 색이 생물 몸 색과
   충분히 멀다면 → `--bg <그 색 hex>`로 지정합니다
   (예: 모서리가 `(22,18,28)`이면 `--bg 16121C`).
3. 이미 투명 배경이라면 → `--bg none`.
4. 예전 방식대로 모서리에서 추정하게 하려면 → `--bg auto`.
   단 어두운 배경 + 어두운 생물 조합에서는 몸이 지워질 수 있으므로,
   아래 크기 편차 경고를 반드시 확인하세요.

## 체크무늬를 그려버린 이미지 (painted checkerboard)

투명 배경을 요청했더니 모델이 **투명을 뜻하는 체크무늬 패턴 자체를 그림으로
그려서** 내놓는 실패가 있었습니다. 실제 파일은 `mode='RGBA'`인데 **픽셀의 100%가
알파 255**(투명 0px, 부분 알파 0px)였고, 배경은 회색 두 톤
`(126,126,137)` / `(177,177,185)`가 약 46px 주기로 번갈아 칠해져 있었습니다.

도구는 이 상황을 따로 감지해서 전용 에러를 냅니다.

```
error: this image has a PAINTED transparency checkerboard, not real transparency.
  alpha channel is present but 100.0% opaque (0 transparent px, 0 partial).
  background is two greys RGB(177,177,185) / RGB(125,125,136) covering 94.5% of the
  image, alternating with a period of ~45px (measured on row y=1).
  The model drew the checkerboard *pattern* that editors use to show transparency
  instead of leaving the background transparent. This cannot be keyed out reliably:
  grey creature pixels are closer to the background greys than the two greys are to
  each other, and edges are anti-aliased against grey with no alpha to recover from.
  Fix: regenerate the image asking for a SOLID #FF00FF magenta background, and
  explicitly tell the model NOT to draw a checkerboard.
```

감지 조건은 세 가지가 **모두** 성립할 때입니다.

1. 알파 채널이 있는데 실질적으로 투명 픽셀이 없음 (알파 0과 부분 알파가 거의 0).
2. 가장 빈번한 색 클러스터 두 개가 **둘 다 무채색 회색**이고, 합쳐서 이미지의
   25% 이상을 차지함.
3. 가장 비어 있는 가로 스캔라인에서 그 두 회색이 **일정한 주기로 번갈아** 나타남
   (런 길이의 중앙값이 4~200px이고, 런의 70% 이상이 중앙값 ±25% 안).

**유일한 해결책은 재생성입니다.** 옵션으로 우회할 수 없습니다. 실측 근거는 이렇습니다.

- 한 생물의 몸 회색이 배경의 어두운 회색과 거리 **11.4**였습니다. 배경 두 회색
  사이의 거리보다도 **더 가깝습니다**. 즉 어떤 임계값을 잡아도 몸과 배경을 나눌 수
  없습니다.
- 다른 생물 내부에는 배경의 밝은 회색과 거리 **3.5**인 픽셀이 774개 있었습니다.
- 모든 경계가 회색에 대해 anti-aliasing되어 있고, 알파가 전부 255이므로 복구할
  정보가 남아 있지 않습니다.

그래서 이 에러 메시지는 `--bg auto`를 대안으로 제시하지 **않습니다**. 실제로
`--bg auto`를 시도해도 쓸 수 없는 결과가 나옵니다. 프롬프트에
`solid #FF00FF magenta background` + `do NOT draw a checkerboard`를 넣어 다시
생성하세요.

## 생성기 워터마크 자동 제거

Gemini는 결과 이미지 우하단에 작은 4각 반짝임 워터마크를 찍습니다. 이게 왜
위험한지가 중요합니다.

실측 예: 2752×1536 시트에서 워터마크는 `x 2477-2528, y 1271-1323` (52×53px,
색 `(201,201,206)`)에 있었습니다. 배경보다 **밝아서** 배경 제거를 살아남았고,
6번째 생물의 x 범위(`2316-2637`) **안쪽**이라 7번째 덩어리를 만들지도 않았습니다.
대신 그 덩어리의 바운딩 박스를 조용히 망가뜨렸습니다.
`y 613-911 (h=299)`이어야 하는데 `y 613-1323 (h=711)`이 되어, 스프라이트가
2.4배 늘어난 채 축소되었습니다. **덩어리 개수 검사로는 절대 잡히지 않습니다.**

그래서 슬라이스 **전에** 행(row) 투영을 계산합니다.

1. 불투명 픽셀이 있는 행들을 연속 구간(**행 밴드**)으로 묶습니다. 빈 행이
   `--row-min-gap`(기본 16) 이상 이어질 때만 밴드를 나눕니다. 열 슬라이서의
   `--min-gap`(기본 4)과 별개인 이유는 실제 워터마크 간격이 ~340행이었기 때문입니다.
2. 불투명 픽셀이 **가장 많은** 밴드를 메인 밴드로 봅니다 (가장 높은 밴드가 아닙니다.
   워터마크가 세로로 길고 얇을 수도 있으므로).
3. 메인 밴드 픽셀 수의 `--outlier-max-share`(기본 0.02 = 2%) 미만인 다른 밴드는
   생성기 노이즈로 보고 **그 행들을 전부 투명하게** 만듭니다.

로그는 이렇게 남습니다 (`--dry-run`에서도 출력됩니다).

```
  dropped outlier row band y 1275-1323 (49 rows, 1596 px, 0.4% of main band) - likely a generator watermark
```

메인이 아닌 밴드가 2% **이상**이면 진짜 콘텐츠일 수 있으므로 **지우지 않고 경고만**
합니다. 슬라이서는 열만 나누기 때문에 (= 가로 한 줄 가정) 격자(grid) 이미지는
잘못 잘립니다.

```
warning: found 1 content row band(s) besides the main one (y 100-300, 76203 px), each too
  large to be noise: y 500-700 (76203 px, 100.0% of main).
  The slicer only splits COLUMNS, i.e. it assumes ONE horizontal row of sprites,
  so a grid will be sliced wrong. Re-crop the input to a single row (--crop
  L,T,R,B), or raise --outlier-max-share (now 0.020) if these really are noise.
```

`--keep-outliers`를 주면 이 제거를 완전히 끕니다. 워터마크가 남으면 위에서 설명한
바운딩 박스 오염이 그대로 재현되고, 대신 크기 편차 경고가 뜹니다
(`group [5] 'f' is 550px tall, 174% taller than the median 201px`).

### 휴리스틱이 실패할 때: `--crop`

워터마크가 생물과 **같은 행 밴드에 겹쳐 있으면** 이 자동 제거는 동작하지 않습니다
(행 투영으로 분리할 수 없기 때문). 그럴 때는 직접 잘라내세요.

```bash
python3 tools/spritify.py sheet input.png --names a,b,c,d,e,f --crop 0,0,2752,1000
```

`--crop`은 **로드 직후, 다른 모든 처리 전에** 적용되고 로그에 남습니다.
오른쪽/아래 좌표는 exclusive입니다 (PIL 관례).

```
  crop: 0,0,1400,600 (right/bottom exclusive) -> 1400x600
```

이미지 범위를 벗어나면 바로 실패합니다.

```
error: bad --crop 0,0,1400,900 for a 1400x800 image.
  need 0 <= L < R <= 1400 and 0 <= T < B <= 800 (right/bottom are exclusive).
```

## 작은 덩어리(speck) 자동 제거 — `--min-area`

행 밴드 제거로도 못 잡는 잔여물이 있습니다. 실측 예: 완성된 `portal.png`(64×96)
안에는 불투명 덩어리가 **2개** 있었습니다. 하나는 실제 스프라이트(1146px,
bbox `(0,24)-(40,70)`), 다른 하나는 스프라이트 오른쪽 끝에서 **22px 떨어진 곳에
있는 2px짜리 `#FF4D6D` 워터마크 잔여물**(bbox `(62,66)-(62,67)`)이었습니다.
팔레트 색에 스냅되어 살아남았고, 행 밴드도 스프라이트와 같은 밴드라 걸리지
않았습니다. 결과적으로 트림 폭이 **41px여야 하는데 63px**로 부풀어(스프라이트
오른쪽에 22px짜리 빈 공간이 붙은 셈), 스프라이트가 그만큼 작게 축소되었습니다.

그래서 **트림(bbox) 직전에** 8-연결 덩어리 필터를 돌립니다 (`sheet`/`single`
**둘 다**, `--dry-run`에서도 동작).

1. 불투명 픽셀의 **8-연결**(대각선 포함) 덩어리를 모두 찾습니다. 4-연결이 아닌
   이유는 픽셀아트의 대각선 계단(꼬리, 더듬이, 이펙트)이 4-연결에서는 여러
   덩어리로 쪼개져 오히려 "speck"으로 오인되기 때문입니다.
2. 불투명 픽셀이 **가장 많은** 덩어리를 메인 덩어리로 봅니다.
3. 면적이 `--min-area` 미만인 나머지 덩어리는 알파 0으로 지웁니다.
   - `--min-area 0.01`(기본): **메인 덩어리 면적의 1%** 미만 (스프라이트 크기가
     제각각이라 기본값은 상대값입니다)
   - `--min-area 500`: **절대 500px** 미만 (1 이상이면 절대 픽셀 수)

로그는 제거한 덩어리마다 한 줄씩 남습니다.

```
  dropped speck component: 2 px at bbox (62,66)-(62,67), 0.17% of main (1146 px)
  speck filter: 1 opaque component(s) kept (--min-area 0.01 = 1% of the main component)
```

`--keep-specks`를 주면 이 제거를 완전히 끕니다 (`speck components: kept (--keep-specks)`).

> ⚠️ **의도적으로 떨어져 있는 작은 요소는 이 필터가 지웁니다.** 몸에서 떨어진
> 반짝임/파티클, 떠 있는 왕관, 알파 컷 때문에 본체와 끊어진 1px 더듬이 끝 같은
> 것들입니다 (기본값이면 메인 1146px 기준 **11px 미만**이 전부 삭제 대상).
> 지워진 것은 항상 로그에 남으니 로그를 확인하고, 필요하면 `--min-area 3`처럼
> **작은 절대값**을 주어 1~2px만 잡게 하거나 `--min-area 0` / `--keep-specks`로
> 끄세요. `sheet` 모드에서 기준은 **시트 전체에서 가장 큰 생물**이므로, 생물
> 크기 차이가 매우 큰 시트에서는 가장 작은 생물이 통째로 지워질 수 있습니다
> (이 경우 덩어리 개수가 줄어 exit 2로 **시끄럽게** 실패합니다).

### `single` 모드 다중 덩어리 경고

`single`은 피사체 하나를 가정하므로, 제거 후에도 `--min-area` 이상인 덩어리가
2개 이상 남으면 **경고**합니다(실패는 아닙니다, 종료 코드 0).

```
warning: 2 opaque components remain above --min-area - 'single' mode expects one sprite; check the input.
```

떠 있는 이펙트나 분리된 파츠가 의도된 것이면 무시해도 됩니다. 반대로 이 경고는
"한 이미지에 두 마리가 들어갔다", "지워야 할 잔여물이 `--min-area`보다 크다"를
잡아줍니다.

### `sheet` 모드에서 `--min-area`와 `--min-width`의 관계

둘은 **완전히 다른 축**을 보며, 순서가 정해져 있습니다.

| | `--min-area` | `--min-width` |
| --- | --- | --- |
| 대상 | 8-연결 **덩어리**(2D) | 슬라이서의 **열 그룹**(x 투영) |
| 시점 | 슬라이스 **전** (입력 이미지 전체에 1회) | 슬라이스 **중** |
| 판정 | 면적(px) | 그룹 폭(px) |
| 결과 | 픽셀을 **지움** | 그 그룹을 **버림** (픽셀은 남음) |

`--min-area`가 먼저 돌기 때문에:

- 생물 **x 범위 안쪽**에 있는 speck은 7번째 열 그룹을 만들지 않으므로
  `--min-width`로는 절대 못 잡습니다. 이건 `--min-area`가 잡습니다.
  (실측: 3px speck이 4번째 생물의 x 범위 안에 있어 그 생물 bbox를
  `49x41` → `49x56`으로 오염시켰고, 폭 편차 경고 임계값(165%)에도 걸리지 않아
  조용히 통과했습니다.)
- 생물 **사이 빈 공간**에 있는 speck은 원래 `--min-width`가 "ignored speck"으로
  버려주던 것인데, 이제 그 전에 `--min-area`가 지웁니다. 그래서 로그에
  `ignored speck at x ...`가 안 뜨고 `dropped speck component: ...`가 뜹니다
  (`--keep-specks`를 주면 예전처럼 `--min-width`가 처리합니다).
- **면적은 크지만 폭이 좁은** 것(예: 4×40px 세로 막대, 160px)은 `--min-area`를
  통과하고 `--min-width 8`에서 걸립니다. 즉 기존 동작이 그대로 유지됩니다.

## 출력에 여백 주기 — `--pad`

실측: `boss-frame.png`(192×128)은 `x=0`과 `x=191`이 모두 불투명입니다. 즉 좌우
여백이 **0**이라 프레임이 캔버스 끝에 딱 붙어 있습니다. 이 상태로 CSS
`image-rendering: pixelated`로 **정수배가 아닌 배율**로 확대하면 맨 바깥 픽셀
열이 깎이거나 인접 픽셀과 다르게 리샘플됩니다.

`--pad N`은 스프라이트를 `--size` 박스에 맞춘 **뒤** 캔버스를 사방으로 N px
넓힙니다. **스케일에는 영향이 없습니다.**

```
  pad: +2px transparent on all sides -> 196x132
```

- `--size 64x64 --pad 2` → **68×68** 파일 (스프라이트는 여전히 64×64 안에 맞춰짐)
- 추가된 여백은 완전 투명이며 RGB도 정확히 `(0,0,0)`입니다 (기존의 "투명 픽셀은
  RGB까지 0" 보장과 동일).
- 기본값은 `0`이므로 아무것도 지정하지 않으면 예전 출력과 **바이트 단위로 동일**합니다.

**캔버스 끝에 닿는 스프라이트에는 `--pad 2`를 권장합니다.** 확대 시 바깥 열/행이
깎이는 것을 막는 bleed 여백입니다. 캔버스 안쪽에 여유가 이미 있는 스프라이트라면
필요 없습니다.

```bash
python3 tools/spritify.py single input.png --name boss-frame --size 192x128 --pad 2
# -> 196x132
```

## 스프라이트 크기 편차 경고

**덩어리 개수가 맞는 것만으로는 슬라이스가 옳다는 증거가 못 됩니다.** 실제
실패 사례에서 6개를 감지하고 이름도 6개였지만, 5번 덩어리만 89px이고 나머지
다섯은 165~167px였습니다 (배경 제거가 몸통 절반을 먹은 것). 개수 검사만으로는
이걸 잡을 수 없습니다.

그래서 슬라이스 후 **너비/높이의 중앙값(median)** 을 구하고, 중앙값의 60% 미만
또는 165% 초과인 덩어리를 경고합니다. `--dry-run`에서도 출력됩니다.

```
warning: group [5] 'repo' is 90px wide, 45% narrower than the median 165px - the key-out may have
  eaten part of it, or two creatures may have merged.
```

- **median보다 훨씬 좁다** → 배경 제거가 그 생물의 일부를 먹었을 가능성이
  높습니다. 배경색과 몸 색이 가까운 경우입니다. `--bg FF00FF` 배경으로 다시
  생성하는 것이 정답입니다.
- **median보다 훨씬 넓다** → 두 생물이 붙어 한 덩어리로 잡힌 것입니다.
  입력을 다시 크롭하거나 다시 생성하세요.
- `--strict`를 주면 이 경고가 에러가 되고 **파일을 하나도 쓰지 않은 채**
  0이 아닌 코드로 종료합니다. 검사용으로 쓰세요.

경고는 stderr로 나가고, 정상 로그(stdout)보다 먼저 눈에 띄도록 출력합니다.

## 슬라이스 감지가 실패했을 때

이름 개수와 감지된 덩어리 개수가 다르면 도구는 **추측하지 않고** 실패합니다
(등분할 fallback 없음). exit code 2와 함께 진단 정보를 출력합니다.

```
error: slice detection found 7 sprite group(s) but 6 --names were given.
  groups (x-range / width):
    [0] 57-223  w=167
    ...
  gaps between groups (x-range / width):
    224-296  w=73
```

대응 순서:

1. **감지된 개수가 이름보다 많다** → 한 생물이 둘로 쪼개진 것입니다.
   출력된 gap 폭을 보고 그 값보다 큰 값으로 `--min-gap`을 올립니다 (예: `--min-gap 12`).
2. **아주 좁은 덩어리(w=2~6)가 섞여 있다** → 노이즈/점입니다.
   `--min-width`를 올립니다 (예: `--min-width 16`).
3. **감지된 개수가 이름보다 적다** → 두 생물이 붙어 있는 것입니다. 옵션으로는
   해결할 수 없습니다. 입력을 다시 크롭해서 사이를 벌리거나, 이미지를 다시
   생성하세요. 급하면 한 마리씩 잘라서 `single` 모드로 처리해도 됩니다.
4. 배경 제거가 과하거나 부족해 보이면 `--fuzz`를 조절하세요
   (과하게 지워짐 → 값을 낮춤 / 배경이 남음 → 값을 올림).

## 출력이 작은 것은 의도된 설계입니다

출력은 확대하지 않습니다. 64×64 같은 작은 PNG를 그대로 배포하고, 브라우저에서
CSS `image-rendering: pixelated`로 확대합니다. 8배 업스케일한 PNG를 배포하면
시각적 이득은 0인데 용량만 커집니다. 스크립트 안에도 같은 주석이 있습니다.
"화질 개선"을 이유로 업스케일 단계를 추가하지 마세요.

또한 출력에는 **부분 알파가 존재하지 않습니다**(알파는 0 또는 255뿐). 이것이
결과물이 진짜 픽셀아트처럼 보이게 하는 핵심이며, 확대해도 흐릿한 테두리가
생기지 않는 이유입니다.

## `tools/`는 배포되지 않습니다

`firebase.json`의 hosting `public` 설정이 `public` 디렉터리만 배포하므로
`tools/`는 프로덕션에 올라가지 않습니다. 의도된 동작이며 변경하지 마세요.
Pillow는 개발 시점 의존성일 뿐, 웹사이트의 런타임 의존성이 아닙니다.
