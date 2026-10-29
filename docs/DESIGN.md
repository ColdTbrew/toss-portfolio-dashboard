# 토스증권 포트폴리오 실시간 대시보드 — 설계

조회 전용(read-only) 대시보드. GX10에서 Tailscale 전용으로 서빙한다. 토스 Open API는 허용 IP(GX10) 에서만 호출된다.

## 0. 불변 규칙 (코드·리뷰·테스트로 강제)

1. **조회 전용.** 코드에 존재해도 되는 토스 엔드포인트는 아래 5개뿐이다. 주문·정정·취소·조건주문·매도가능수량·수수료 등 다른 경로는 문자열로도 넣지 않는다.
   - `POST /oauth2/token`
   - `GET /api/v1/accounts` (accountSeq 캐시가 없을 때 1회만)
   - `GET /api/v1/holdings`
   - `GET /api/v1/buying-power?currency=KRW|USD`
   - `GET /api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW`
   - WS `wss://openapi-ws.tossinvest.com/ws/v1` — `trade:kr`, `trade:us` 구독만 (orderbook·personal:order 미사용)
2. **시크릿은 레포에 없다.** client id/secret, 토큰, 계좌번호, 장부(`portfolio.jsonl`), DB 는 env 또는 파일 경로로만 받는다. `.gitignore` + gitleaks(CI·pre-commit) 로 막는다.
3. **로그에 시크릿이 없다.** 헤더는 절대 로그하지 않는다. 에러는 `status + code + message(200자)` 로만 요약하고 `redact()` 를 통과시킨다.
4. **토큰은 클라이언트당 1개.** 새로 발급하면 기존 토큰이 즉시 죽는다 → `~/invest/.token.json` 을 `toss.py` 와 공유하고, 유효하면 재사용, 만료 시에만 락 안에서 발급.
5. **WS 는 서버당 정확히 1개.** 계정당 동시 2개 제한이고, 초과 시 *가장 오래된 연결이 끊긴다*(다른 봇의 연결을 죽일 수 있음). 두 번째 연결을 절대 만들지 않는다.
6. 바인드는 Tailscale IP(<tailscale-ip>) 또는 127.0.0.1. `0.0.0.0` 금지.

## 1. 스택

- TanStack Start (공식 CLI 스캐폴드, React 19, Vite 8, Nitro `node-server` 프리셋) + Tailwind v4 (스캐폴드 포함)
- 런타임 Node 24 (GX10: `~/.local/opt/node24`, sudo 불필요)
- 추가 의존성 최소화: `ws` (헤더 지원 WS 클라이언트), `recharts` (차트), `vitest` (테스트). 그 외는 추가 전 정당화.
- 금액 계산: API 는 decimal 문자열. 표시용 계산은 `number` 로 충분하되 원화 합계는 반올림(정수)해서 표시. 장부(append) 값은 기존 `summarize.py` 와 같이 **문자열** 로 기록.

## 2. 설정 (env)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `TOSS_ENV_PATH` | `~/invest/.toss.env` | `TOSS_CLIENT_ID=…`, `TOSS_CLIENT_SECRET=…` (KEY=VALUE 줄) |
| `TOSS_TOKEN_PATH` | `~/invest/.token.json` | toss.py 와 공유하는 토큰 캐시 |
| `TOSS_ACCOUNT_PATH` | `~/invest/account.json` | accountSeq 캐시 |
| `PORTFOLIO_LEDGER_PATH` | `~/invest/portfolio.jsonl` | 일별 스냅샷 장부 |
| `TOSS_MOCK` | unset | `1` 이면 네트워크 0, 픽스처 + 가짜 틱 (개발·스크린샷·CI) |
| `SNAPSHOT_ENABLED` | `1` (mock 에선 무시) | 일별 스냅샷 자동 기록 |
| `SNAPSHOT_TIME_KST` | `16:10` | 해당 시각 이후 첫 갱신 때 그날 스냅샷 1회 |
| `REFRESH_HOLDINGS_SEC` | `30` | holdings 폴링 |
| `REFRESH_CASH_FX_SEC` | `60` | buying-power ×2, exchange-rate 폴링 |
| `HOST` / `PORT` | Nitro 기본 | systemd 에서 `HOST=<tailscale-ip> PORT=8790` |

`~` 확장은 앱이 직접 처리. 경로 파일이 없으면 명확한 에러(값 노출 없이).

## 3. 모듈 구조

```
src/
  server/                     # 서버 전용 (클라이언트 번들 금지, 파일명 *.server.ts 또는 server/ 하위에서만 import)
    config.ts                 # env 파싱 → Config (경로, 주기, mock 여부)
    redact.ts                 # redact(str), summarizeHttpError(status, body)
    fileLock.ts               # withFileLock(lockPath, fn, {timeoutMs, staleMs}) — O_EXCL lockfile
    atomicWrite.ts            # writeJsonAtomic(path, obj) — tmp + fsync + rename, mode 600
    tokenStore.ts             # getToken({force?, rejectedToken?}) — 공유 캐시/락/발급
    tossClient.ts             # 허용된 5개 호출만 있는 클라이언트 (fetch)
    endpoints.ts              # ALLOWED 경로 상수 (테스트가 이 집합과 소스 전체를 대조)
    account.ts                # getAccountSeq() — account.json 우선, 없으면 /accounts 1회 후 같은 포맷으로 저장
    portfolioService.ts       # 폴링 루프 + 최신 PortfolioState 보관 + 구독자 notify (singleton)
    realtime.ts               # WS 단일 연결 매니저 (singleton) → tick 이벤트
    sseHub.ts                 # SSE 클라이언트 집합, broadcast, heartbeat
    ledger.ts                 # portfolio.jsonl 읽기(트렌드) / 스냅샷 생성 / append(락)
    mock.ts                   # 픽스처 상태 + 가짜 틱 생성기
  lib/                        # 서버·클라이언트 공용 순수 함수
    types.ts                  # 도메인 타입
    compute.ts                # applyTick(state, tick), totals 재계산, 비중
    format.ts                 # 원/달러/퍼센트 포맷 (ko-KR)
  routes/
    __root.tsx                # lang="ko", 테마 스크립트(FOUC 방지), devtools 는 dev 에서만
    index.tsx                 # 대시보드
    api/portfolio.ts          # GET → PortfolioState JSON (서버 캐시, 토스 직접 호출 아님)
    api/trend.ts              # GET → TrendPoint[] (ledger)
    api/stream.ts             # GET → text/event-stream (SSE)
    api/health.ts             # GET → {ok, mock, wsState, lastRefreshAt} (시크릿 없음)
  components/
    SummaryCards.tsx  HoldingsTable.tsx  AllocationChart.tsx  PnlBarChart.tsx
    TrendChart.tsx    ThemeToggle.tsx    LiveBadge.tsx
deploy/
  toss-dashboard.service      # systemd --user 유닛 템플릿
  toss-dashboard.env.example  # 경로만 (값 없음)
scripts/
  build-on-gx10.sh            # GX10 에서 npm ci && npm run build
  install-service.sh          # 유닛 복사 + daemon-reload 만. enable/start 는 하지 않음 (--start 플래그 시에만)
  secret-scan.sh              # gitleaks 실행 (pre-commit / 수동)
.gitleaks.toml  .pre-commit-config.yaml  .github/workflows/ci.yml
```

서버 전용 모듈은 TanStack Start 서버 라우트 핸들러(`createFileRoute(...)({ server: { handlers: { GET } } })`)에서만 import 한다. 클라이언트 번들에 `src/server/**` 가 들어가지 않는지 빌드 결과로 확인.

## 4. 도메인 타입 (`src/lib/types.ts`)

토스 원본(필드명 그대로):
```ts
type Money = string // decimal 문자열
interface ByCcy { krw: Money; usd: Money }
interface HoldingsItem { symbol; name; marketCountry: 'KR'|'US'; currency: 'KRW'|'USD'; quantity; lastPrice; averagePurchasePrice;
  marketValue: { purchaseAmount; amount; amountAfterCost }; profitLoss: { amount; amountAfterCost; rate; rateAfterCost };
  dailyProfitLoss: { amount; rate }; cost: { commission; tax } }
interface HoldingsOverview { totalPurchaseAmount: ByCcy; marketValue: { amount: ByCcy; amountAfterCost: ByCcy };
  profitLoss: { amount: ByCcy; amountAfterCost: ByCcy; rate; rateAfterCost }; dailyProfitLoss: { amount: ByCcy; rate }; items: HoldingsItem[] }
interface BuyingPower { currency; cashBuyingPower }
interface ExchangeRate { baseCurrency; quoteCurrency; rate; midRate; basisPoint; rateChangeType; validFrom; validUntil }
```
`rate` 필드는 모두 **소수 비율**(0.1516 = 15.16%).

앱 상태(서버 → 브라우저):
```ts
interface PortfolioState {
  fetchedAt: string            // KST ISO
  mock: boolean
  fx: { midRate: number; buyRate: number; validFrom: string } | null
  cash: { krw: number; usd: number; totalKrw: number } | null
  holdings: HoldingRow[]
  totals: { totalAssetsKrw; stocksEvalKrw; purchaseKrw; profitLossKrw; returnRate; dailyPlKrw; dailyPlRate } // number
  errors: Record<string, string>  // redacted 요약, 부분 실패 허용
}
interface HoldingRow { symbol; name; market: 'KR'|'US'; currency; quantity: number; avgPrice: number; lastPrice: number;
  basePrice: number   // REST 시점 lastPrice (틱 반영 시 일간손익 보정 기준)
  purchaseAmount: number; evalAmount: number; profitLoss: number; returnRate: number; dailyPl: number;
  evalKrw: number; weight: number; lastTickAt?: string }
interface Tick { symbol: string; market: 'kr'|'us'; price: number; timestamp: string }
interface TrendPoint { date: string; ts: string; totalAssetsKrw: number; profitLossKrw: number; purchaseKrw: number; returnRate: number }
```
계산식은 `summarize.py` 와 동일: 해외 금액의 원화 환산은 `midRate`, 현금 합계 = `KRW + USD×mid`, 총자산 = 주식평가(KRW 환산) + 현금, 비중 = evalKrw / 총자산.

## 5. 토큰 캐시 / 락 (`tokenStore.ts`)

캐시 포맷(toss.py 와 동일, 변경 금지): `{"access_token", "token_type", "issued_at": <epoch sec float>, "expires_at": <epoch sec float>}`.

`getToken({ rejectedToken? })`:
1. 캐시 읽기. `expires_at - 120 > now` 이고 `access_token !== rejectedToken` 이면 그대로 반환 (락 없음, 대부분 경로).
2. 아니면 `withFileLock(tokenPath + '.lock')` 진입 → **락 안에서 캐시를 다시 읽고** 1번 조건을 재확인(다른 프로세스가 방금 발급했을 수 있음) → 여전히 무효면 발급.
3. 발급: `POST /oauth2/token` form(`grant_type=client_credentials`, client_id, client_secret). 401 이면 HTTP Basic 으로 1회 재시도 (toss.py 와 동일 동작).
4. `writeJsonAtomic(tokenPath, …)` — 같은 디렉터리 tmp 파일(`.token.json.<pid>.<rand>.tmp`), mode 600, fsync, rename.
5. 프로세스 내 동시 호출은 in-flight promise 하나로 합친다 (single-flight).

API 401(`invalid-token`/`expired-token`/`token-revoked`) 처리: `getToken({ rejectedToken: usedToken })` → 캐시가 이미 다른 토큰이면 그걸로 재시도(toss.py 가 갱신한 경우), 같으면 락 안에서 재발급. 재시도는 1회. **401 루프로 서로 토큰을 죽이는 핑퐁 방지**: 발급 후 60초 안에 또 401 이면 재발급하지 않고 에러 상태로 둔다.

파일 락: `fs.open(lockPath, 'wx', 0o600)` (O_CREAT|O_EXCL), 내용 `{pid, host, createdAt}`. 100ms 간격 재시도, 기본 timeout 10s, `staleMs` 30s 넘은 락은(소유 pid 가 죽었거나 오래됨) 제거 후 재시도. 해제는 finally 에서 unlink.
> **주의:** 현재 `~/invest/toss.py` 는 이 락을 모른다. toss.py 가 유효 토큰을 재사용하므로 실제 충돌 창은 만료 직전 몇 초뿐이다. 완전한 상호배제를 원하면 toss.py `get_token()` 에 같은 lockfile 규약(O_EXCL `.token.json.lock`)을 넣는 작은 패치가 필요하다 — toss.py 는 투자봇 소유라 이 레포에서는 수정하지 않는다.

## 6. 토스 클라이언트 (`tossClient.ts`, `endpoints.ts`)

```ts
export const TOSS_REST_BASE = 'https://openapi.tossinvest.com'
export const TOSS_WS_URL = 'wss://openapi-ws.tossinvest.com/ws/v1'
export const ALLOWED_ENDPOINTS = { token: '/oauth2/token', accounts: '/api/v1/accounts', holdings: '/api/v1/holdings',
  buyingPower: '/api/v1/buying-power', exchangeRate: '/api/v1/exchange-rate' } as const
```
공개 함수는 `getHoldings(seq)`, `getBuyingPower(seq, 'KRW'|'USD')`, `getExchangeRate()`, `listAccounts()` 뿐. 범용 `request(path)` 를 export 하지 않는다. 내부 `get()` 도 path 가 ALLOWED 집합에 없으면 throw.
- 헤더: `Authorization: Bearer`, `Accept: application/json`, 계좌 API 는 `X-Tossinvest-Account: <accountSeq>`.
- 응답 envelope `{ result }` 에서 `result` 반환.
- 429: `Retry-After`(없으면 1.5s) 만큼 대기 후 1회 재시도. timeout 15s (AbortController).
- 에러 메시지: `GET /api/v1/holdings: HTTP 401 code=expired-token msg=…` 형태, `redact()` 통과.

`account.ts`: `account.json` 의 `accountSeq` 사용. 없을 때만 `/accounts` 1회(ACCOUNT 그룹 1 req/s) → BROKERAGE 우선 선택 → toss.py 와 같은 포맷(`accountSeq, accountType, accountNoMasked(끝 4자리 외 *), count, cachedAt`)으로 atomic 저장. **accountNo 원문은 메모리에서도 즉시 버린다.** accountSeq 와 계좌번호는 브라우저로 보내지 않는다.

## 7. 폴링 서비스 (`portfolioService.ts`)

- 서버 프로세스 singleton (`globalThis` 키로 HMR/중복 import 방지).
- 시작: 첫 API 요청 시 lazy start (또는 Nitro 플러그인). mock 이면 픽스처.
- holdings 30s, cash(KRW·USD)·fx 60s. 호출 사이 400ms 간격(toss.py 와 동일). 부분 실패 허용: 실패 항목은 직전 값 유지 + `errors[key]`.
- 갱신될 때마다 `PortfolioState` 재계산 → SSE `snapshot` 이벤트. 보유 종목 집합이 바뀌면 realtime 에 구독 목록 전달.
- 장 외 시간에도 폴링은 계속하되(주기 동일, 가벼움) 연속 실패 시 지수 백오프(최대 5분).

## 8. 실시간: WS 1개 → SSE (`realtime.ts`, `sseHub.ts`)

상태 머신: `idle → connecting → open → (closed → backoff → connecting)`; `stopped`.
- **연결 조건:** SSE 클라이언트 ≥1 이고 보유 종목 ≥1 일 때만 연결. 클라이언트 0 이 된 뒤 120초 지나면 `[]` 선언 후 close → 다른 봇이 쓸 WS 슬롯을 비워 둔다.
- 연결 객체는 모듈 singleton 하나. `connect()` 는 현재 소켓이 `CONNECTING|OPEN` 이면 no-op. 재연결 전 기존 소켓이 완전히 닫혔는지 확인 (`terminate()` 후 null).
- 핸드셰이크 헤더 `Authorization: Bearer <token>` (tokenStore). 401 → `getToken({rejectedToken})` 후 재연결, 403 → 에러 상태로 두고 5분 백오프.
- 선언: `[{"id":"dash-<n>"},{"type":"trade:kr","codes":[KR…]},{"type":"trade:us","codes":[US…]}]` (빈 시장은 생략). full-replace 이므로 종목 변경 시 전체 배열 재전송. 선언 빈도 ≤ 1회/초로 디바운스. ack 의 `rejected` 종목은 다음 선언에서 제외.
- keepalive: 60초마다 텍스트 `PING` (서버는 클라이언트 수신 180초 없으면 종료).
- 수신: `type=message`, `topic=trade:{kr|us}:{symbol}`, `data.price`(문자열) → `Tick`. `error` 프레임: `rate-limit-exceeded` 면 1s 후 재선언, `server-shutdown` 이면 재연결.
- 재연결 백오프: 1s, 2s, 4s … 최대 60s, ±20% jitter. open 후 60초 유지되면 백오프 리셋.
- 틱 → 서버 상태에도 `applyTick` 반영(새로고침 시 최신가) → SSE `tick` 이벤트. 브라우저 폭주 방지: 심볼별 최신값만 모아 250ms 마다 배치 전송(`ticks` 이벤트, `Tick[]`).

SSE (`/api/stream`): `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`. 연결 직후 `snapshot` 1회, 이후 `snapshot`/`ticks`/`status`(`{ws: state, lastRefreshAt}`) 이벤트, 15초마다 `: ping` 코멘트. request abort 시 구독 해제. 브라우저는 `EventSource` (자동 재연결).

## 9. 일별 스냅샷 / 장부 (`ledger.ts`)

기존 장부 한 줄 스키마(`summarize.py`)를 **그대로** 따른다:
```
{date, ts, source, fx:{pair,midRate,buyRate,validFrom,usedForKRW}, cash:{KRW,USD,basis,totalKRW},
 totals:{stocksEvalKRW, stocksEvalByCcy, purchaseByCcy, profitLossByCcy, plRateApi, dailyPLByCcy, dailyPLRateApi, purchaseKRW, profitLossKRW, totalAssetsKRW},
 holdings:[{symbol,name,market,currency,quantity,avgPrice,lastPrice,purchaseAmount,evalAmount,evalAfterCost,profitLoss,returnRate,dailyPL,evalKRW,weight}]}
```
- 값은 summarize.py 와 같은 문자열·반올림 규칙(원화 정수 ROUND_HALF_UP, weight 소수 2자리). `source: "toss-dashboard"`, `date` 는 KST 날짜.
- 생성 입력은 **REST 원본**(raw holdings/cash/fx). 틱 반영값으로 쓰지 않는다.
- 기록 규칙: `SNAPSHOT_TIME_KST` 이후 첫 성공 갱신 시, 그 KST 날짜의 줄이 장부에 **하나도 없으면** 1줄 append. 이미 있으면(투자봇이 썼든 앱이 썼든) 쓰지 않는다 → 중복 없음.
- append: `withFileLock(ledgerPath + '.lock')` 안에서 재확인 후 `O_APPEND` 로 `JSON + "\n"` 한 번에 write. 파일 없으면 mode 600 으로 생성. 기존 줄은 절대 수정·재작성하지 않는다.
- 읽기(트렌드): 줄 단위 파싱, 깨진 줄은 건너뛰고 카운트만 경고. 같은 date 여러 줄이면 `ts` 가 가장 늦은 것. `TrendPoint` 로 변환(`returnRate = profitLossKRW / purchaseKRW`).

## 10. UI (`routes/index.tsx`)

한국어, 모바일 대응, 다크/라이트(시스템 기본 + 토글, `localStorage`, `<html class="dark">`, 첫 페인트 전 인라인 스크립트로 FOUC 방지). 한국 관례 색: **상승/이익 빨강, 하락/손실 파랑**.

```
┌ 헤더: "내 포트폴리오"  [실시간● 연결됨/재연결 중/장외]  마지막 갱신 22:31:05  [🌙/☀️] ┐
├ 요약 카드 5개: 총자산 · 총 수익률(평가손익) · 오늘 손익 · 현금(KRW / USD) · 환율(USD/KRW mid) ┤
├ [비중 도넛 차트]                    [종목별 손익 막대 차트 (원화 환산, 정렬)] ┤
├ 수익률 추이 (장부 기반 라인: 총자산 / 수익률 토글) ┤
└ 보유종목 테이블: 필터 [전체|국내|해외], 열 클릭 정렬(종목, 수량, 평균가, 현재가, 평가금액(원), 손익, 수익률, 오늘손익, 비중), 
   틱 수신 시 현재가 셀 짧게 깜빡임(빨/파), 해외는 USD 표시 + 원화 환산 보조 ┘
```
- 초기 데이터: 라우트 loader 가 서버 함수/`/api/portfolio` 로 SSR, 이후 SSE 로 갱신.
- 에러가 있으면 상단에 비침해적 배너(redacted 메시지).
- 계좌번호·accountSeq 는 UI 어디에도 없음.
- 프로덕션 빌드에서 TanStack devtools 제거.

## 11. 보안·운영

- `.gitignore`: 기존 + `.env*`(단 `.env.example` 허용), `*.jsonl`, `*.db`, `*.sqlite*`, `.token*`, `account.json`, `*.pem`, `last_raw.json`, `portfolio*.json*`.
- `.gitleaks.toml`: 기본 규칙 + 토스 client secret 패턴(`tsck_live_…`, `tssk_…` 등 접두어)과 JWT.
- CI (`.github/workflows/ci.yml`, ubuntu): `gitleaks/gitleaks-action` 대신 gitleaks 바이너리(checksum 검증)로 전체 히스토리 스캔 → `npm ci` → `npm run typecheck` → `npm test` → `npm run build`. 모두 `TOSS_MOCK=1`, 네트워크 시크릿 없음.
- `.pre-commit-config.yaml`: gitleaks hook. `scripts/secret-scan.sh` 로 수동 실행.
- 로깅: `console` 래퍼 `log.info/warn/error` 가 모든 문자열을 `redact()` 통과.
  - redact 대상: `Bearer <…>`, `Basic <…>`, JWT(`eyJ…\.…\.…`), `access_token`/`client_secret`/`client_id` 값(JSON·form·query), `X-Tossinvest-Account: …`, 연속 숫자 8자리 이상·`\d{3,}-\d{2,}-\d{3,}` 계좌번호 패턴.

## 12. 서빙 (GX10)

- 경로: `~/apps/toss-portfolio-dashboard` (git clone), 빌드 `npm ci && npm run build` (arm64 네이티브 바인딩 때문에 GX10 에서 빌드).
- 실행: `node .output/server/index.mjs`, `HOST=<tailscale-ip>`, `PORT=8790` (GX10 에서 미사용 확인됨).
- 접속: `http://<tailscale-ip>:8790` / `http://<tailscale-host>:8790` (Tailscale 내부만).
- `deploy/toss-dashboard.service` (systemd --user):
  `ExecStart=%h/.local/opt/node24/bin/node %h/apps/toss-portfolio-dashboard/.output/server/index.mjs`,
  `EnvironmentFile=%h/.config/toss-dashboard.env`, `Environment=NODE_ENV=production HOST=<tailscale-ip> PORT=8790`,
  `MemoryMax=768M`, `MemoryHigh=640M`, `CPUQuota=100%`, `Nice=10`, `Restart=on-failure`, `RestartSec=10`, `StartLimitIntervalSec=0`(부팅 시 tailscale0 가 늦게 올라와도 재시도), `NoNewPrivileges=yes`, `PrivateTmp=yes`, `UMask=0077`, `--max-old-space-size=384`.
- `scripts/install-service.sh`: 유닛을 `~/.config/systemd/user/` 로 복사, env 파일 없으면 예제 복사(경로만), `daemon-reload`. **enable/start 하지 않음.** 시작은 승혁님 확인 후 `systemctl --user enable --now toss-dashboard`.
- linger: coldbrew 는 이미 `Linger=yes` (재부팅 후 자동 시작 가능).

### 종료 (SIGTERM / SIGINT)

- `vite.config.ts` 의 Nitro `plugins` 에 `src/server/plugins/shutdown.ts` 를 명시 등록한다. 설치된 Nitro 3 버전은 기본 디렉터리 스캔이 꺼져 있고, `node-server` 의 신호 처리는 HTTP 리스너만 닫으므로 플러그인이 프로세스 신호와 Nitro `close` 훅을 모두 연결한다. 기존 서버 라우트 외 서버 모듈 import 는 이 수명주기 플러그인에서도 허용한다.
- 프로세스 singleton 종료 promise 로 중복 신호/훅을 합친다. holdings·cash·fx 폴링(같은 루프의 일별 스냅샷 포함)과 mock 틱을 중단하고, WS 의 ping·재연결·idle·선언·안정화·close 타이머를 지운 뒤 소켓을 `terminate()` 한다. 이후 재연결은 금지한다. SSE 스트림을 모두 닫고 heartbeat·tick batch 타이머를 지우며 새 스트림에는 503 을 반환한다.
- 진행 중인 refresh(장부 append·계좌 캐시 저장 포함)와 WS 토큰 획득(토큰 atomic write 포함)이 끝날 때까지 기다린다. 락은 기존 쓰기 함수의 `finally` 에서만 해제하며 종료 코드가 직접 unlink 하지 않는다. 폴링·WS·SSE 및 요청 timeout 타이머는 `unref()` 한다. 진행 중 작업의 짧은 pacing/락 대기·REST 재시도 대기는 작업 완료까지 유지한다.
- 정상 정리 후 exit code 0 으로 자연 종료한다. 첫 신호/훅에서 시작하는 5초 `unref()` 타이머는 정리 후에도 남겨, 미완료 작업이나 다른 열린 핸들이 있으면 `process.exit(0)` 한다. 강제 종료 시 락을 먼저 풀지 않으며, 남은 락은 다음 프로세스가 기존 dead-pid/stale 규칙으로 회수한다. OS 장애로 5초 내 쓰기가 완료되지 않는 경우까지 정상 완료를 보장하지는 않는다.
- systemd 유닛은 `TimeoutStopSec=15`, `KillMode=mixed`: 먼저 주 프로세스에 SIGTERM, 제한 시간 초과 시 남은 프로세스를 강제 종료한다.

## 13. 테스트 계획 (vitest)

| 테스트 | 검증 |
|---|---|
| `tokenStore.test.ts` | 유효 캐시 재사용(발급 0회) / 만료 시 1회 발급 + 포맷·mode 600 / 동시 10개 호출 → 발급 1회(single-flight) / 두 "프로세스"(락 경쟁) → 발급 1회 / 락 안 재확인(다른 쪽이 먼저 써 둔 토큰 사용) / stale 락 회수 / rejectedToken 처리 |
| `readOnly.test.ts` | `src/**` 전체를 grep: `/api/v1/...` 문자열 집합 ⊆ 허용 4개, `orders`·`conditional`·`sellable`·`commission` 경로 없음, `method: 'POST'` 는 tokenStore 의 `/oauth2/token` 뿐, WS 선언 type 은 `trade:` 만 |
| `ledger.test.ts` | 실제 장부와 같은 스키마의 픽스처(가짜 값) 파싱 / 깨진 줄 skip / 같은 날 최신 줄 선택 / append 가 기존 바이트를 그대로 두고 1줄 추가 / 같은 날 이미 있으면 skip / summarize.py 와 같은 문자열 반올림 |
| `redact.test.ts` | Bearer·JWT·client_secret·계좌번호 패턴 마스킹, 에러 요약에 헤더 없음 |
| `compute.test.ts` | 틱 반영 후 평가금액·손익·일간손익·총자산·비중 재계산, 환율 적용 |
| `realtime.test.ts` | 가짜 WS 서버로: 연결 1개만 / 재연결 백오프 / 중복 connect no-op / 구독 선언 형식 / PING 주기 |

빌드 후 `.output/public` 에 `server/` 모듈·시크릿 경로 문자열이 없는지 간단 grep. 실제 API 스모크는 GX10 에서 `timeout` 으로 foreground 실행.

## 14. 금액 가리기 (privacy mask)

목적: 수익률·비중은 보이고 절대 금액은 안 보이는 화면을 캡처해서 공유할 수 있게.

- 헤더에 토글 버튼 `금액 가리기` (눈 아이콘, `aria-pressed`). 상태는 `localStorage['tpd:maskAmounts']` 에 저장, 기본 off. SSR 첫 렌더는 **가린 상태**로 그리고 hydrate 후 저장값 적용 (저장값이 on 인데 SSR 이 금액을 내보내는 일을 막기 위함).
- **진짜 마스킹:** 가려진 상태에서는 금액 숫자를 DOM·속성(`title`, `aria-label`, `data-*`)·차트 툴팁/라벨 어디에도 렌더하지 않는다. CSS blur 금지. 공용 컴포넌트 `<Amount value currency />` 가 `useMask()` 컨텍스트를 보고 `•••••` 만 렌더한다. 금액을 표시하는 모든 곳은 이 컴포넌트(또는 `formatAmount(value, {masked})`)만 거친다.
- 가리는 것: 총자산, 현금(KRW/USD), 평가금액, 매입금액, 손익 금액, 오늘 손익 금액, 종목별 수량·평균가·평가금액·손익 금액, 차트의 금액 축·툴팁·라벨.
- 보이는 것: 총 수익률, 오늘 수익률, 종목별 수익률·오늘 수익률, 비중 %, 현재가(시장 공개 정보, 내 자산 규모 유추 불가) , 환율, 차트 모양.
  - 종목별 손익 막대 차트는 가려진 상태에서 **수익률(%) 막대**로 전환. 수익률 추이 차트는 `수익률` 모드만 허용(총자산 모드 비활성).
- 내부 데이터(`PortfolioState`)는 그대로 클라이언트에 있다 — 이 기능은 *화면 캡처* 유출 방지용이지 접근 제어가 아니다 (대시보드 자체는 Tailscale 전용).

## 15. 공유 이미지 추출 (`추출`)

- 헤더 버튼 `추출` → 모달: 미리보기 + 옵션 체크박스 `금액 포함` (기본 **해제**, 토글 상태와 무관하게 매번 해제로 시작) + 버튼 `PNG 저장`, `클립보드 복사`(`navigator.clipboard.write` + `ClipboardItem` 지원 시에만 노출).
- 카드 내용: 제목 "내 포트폴리오", 날짜(KST), 총 수익률, 오늘 수익률, 비중 도넛(상위 6 + 기타), 수익률 상위 종목 5개(종목명 + 수익률%), 하단 작은 워터마크 "toss-portfolio-dashboard". `금액 포함` 일 때만 총자산·손익 금액 추가.
- **절대 포함 금지:** 계좌번호, accountSeq, 계좌명/고객명, 토큰.
- 구현 (의존성 추가 없음):
  - `src/lib/shareCard.ts` — 순수 함수 `buildShareCardModel(state, { includeAmounts, now }) → ShareCardModel`. 기본(includeAmounts=false) 모델에는 금액 필드 자체가 없다(타입으로 강제: `amounts?: {...}` 는 includeAmounts=true 일 때만 존재).
  - `src/lib/shareCardCanvas.ts` — `drawShareCard(ctx, model, theme)` Canvas 2D 로 1080×1350 렌더(도넛은 arc 로 직접). `canvas.toBlob('image/png')` → 다운로드(`portfolio-YYYYMMDD.png`) / 클립보드.
  - 테마: 현재 다크/라이트를 따른다.
  - 미리보기도 같은 canvas 결과(`<img src=blob>`) — DOM 에 금액 텍스트가 생기지 않는다.

## 16. 추가 테스트

| 테스트 | 검증 |
|---|---|
| `mask.test.tsx` | 픽스처 상태로 대시보드 주요 컴포넌트(요약 카드, 보유 테이블, 차트 래퍼)를 `react-dom/server` `renderToStaticMarkup` 로 masked 렌더 → 픽스처의 모든 절대 금액(총자산, 현금, 평가·손익 금액, 수량, 평균가)의 포맷 문자열(콤마 포함/미포함, 원·$ 형식)이 HTML 에 **하나도 없음**, 수익률 % 문자열은 있음. unmasked 렌더에는 금액이 있음(테스트가 실제로 검출 가능한지 확인) |
| `shareCard.test.ts` | 기본 모델 JSON 직렬화에 금액·수량 값 없음, `amounts` 키 없음, 계좌 관련 키 없음 / includeAmounts=true 일 때만 금액 존재 / 상위 종목은 수익률 내림차순 5개 / 가짜 Canvas 컨텍스트로 `drawShareCard` 호출 시 `fillText` 인자에 금액 문자열 없음(기본 모드) |
