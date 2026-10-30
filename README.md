# 내 포트폴리오

토스증권 국내·해외 보유종목, 현금, 수익률을 한 화면에서 확인하는 **조회 전용** 대시보드입니다. TanStack Start · React 19 · Tailwind v4 · Recharts · Node 24를 사용합니다. GX10에서 빌드하고 Tailscale 내부에서 접속합니다.

거래를 실행하는 기능은 없습니다. 토스 REST 호출은 인증, 계좌 목록, 보유종목, 현금, 환율, 캔들 조회만 허용하며, WebSocket은 국내·미국 체결 구독만 사용합니다. 서버의 연결 하나를 여러 브라우저가 SSE로 공유합니다. 로컬 토큰·계좌 캐시와 일별 장부는 저장하지만 토스 자산을 변경하지 않습니다. 허용 경로와 요청 메서드는 자동 테스트로 검사합니다.

## 개발: 모의 데이터

Node 24와 프로젝트 의존성이 필요합니다. 설치 후 다음 명령으로 실행합니다.

```bash
export PATH="$HOME/.local/opt/node24/bin:$PATH"
npm ci
npm run dev:mock
```

접속 주소는 `http://127.0.0.1:3100`입니다. `TOSS_MOCK=1`에서는 가상 국내·해외 종목, 90일 추이, 초당 틱을 사용합니다. 토스 네트워크 호출이나 `~/invest` 파일 읽기·쓰기는 없습니다. 브라우저는 대시보드 자체의 API/SSE에만 연결합니다. 실제 개발 서버 실행은 접근 가능한 환경에서 직접 진행하세요.

## 화면과 공유

- 총자산·총 수익률·오늘 손익·현금·환율, 비중 도넛, 종목별 손익, 일별 추이를 표시합니다.
- 보유종목은 전체·국내·해외 필터와 열 정렬을 지원합니다. 상승·이익은 빨강, 하락·손실은 파랑입니다.
- 시스템 테마를 따르며 수동 선택은 `localStorage['tpd:theme']`에 저장합니다.
- `금액 가리기`는 금액·수량·평균가를 실제 DOM에서 제외합니다. SSR은 항상 가린 상태이며, hydration 후 `tpd:maskAmounts` 저장값을 적용합니다. 저장값이 없으면 표시합니다. 현재가·환율·수익률·비중은 유지하며 차트도 비율로 전환합니다.
- `추출`은 1080×1350 PNG를 만듭니다. `금액 포함`은 모달을 열 때마다 해제됩니다. 기본 이미지에는 비율과 종목명만, 명시적으로 체크할 때 총자산·평가손익을 추가합니다. 계좌 식별자·계좌명·토큰은 모델에 포함하지 않습니다.
- 클립보드 복사는 브라우저가 `navigator.clipboard.write`와 `ClipboardItem`을 제공할 때만 나타납니다. 일반 HTTP에서는 PNG 저장을 이용할 수 있습니다.

마스킹은 화면 캡처를 위한 기능입니다. 원본 포트폴리오 데이터는 브라우저 메모리와 SSR 데이터에 있으므로 접근 제어를 대신하지 않습니다.

## 환경 변수

시크릿은 레포 밖에서 관리합니다. 앱이 경로의 `~`를 직접 확장합니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `TOSS_ENV_PATH` | `~/invest/.toss.env` | client id/secret이 담긴 KEY=VALUE 파일 경로 |
| `TOSS_TOKEN_PATH` | `~/invest/.token.json` | toss.py와 공유하는 토큰 캐시 |
| `TOSS_ACCOUNT_PATH` | `~/invest/account.json` | 계좌 식별자 캐시 |
| `PORTFOLIO_LEDGER_PATH` | `~/invest/portfolio.jsonl` | 기존 장부 읽기·일별 스냅샷 append |
| `TOSS_MOCK` | 미설정 | `1`이면 모의 데이터 |
| `UPSTREAM_URL` | 미설정 | 기존 대시보드의 HTTP(S) 원점; proxy preview 모드 |
| `SNAPSHOT_ENABLED` | `1` | `0`이면 일별 기록 중단; mock/proxy에서는 항상 중단 |
| `SNAPSHOT_TIME_KST` | `16:10` | 해당 시각 이후 첫 성공 갱신 때 하루 1회 기록 |
| `REFRESH_HOLDINGS_SEC` | `30` | 보유종목 갱신 주기 |
| `REFRESH_CASH_FX_SEC` | `60` | 현금·환율 갱신 주기 |
| `HOST` | 기본값 없음 (프로덕션 필수) | 레포 밖의 `~/.config/toss-dashboard.env`에 Tailscale IP 지정 |
| `PORT` | 배포 유닛에서 `8790` 지정 | HTTP 수신 포트 |

서버 환경의 `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`도 지원하지만, 배포 예제에는 HOST 자리표시자와 경로만 둡니다. 실제 주소·인증 값을 클라이언트용 환경 변수로 넣거나 레포·로그·스크린샷에 남기지 마세요.

## Proxy preview

이미 실행 중인 대시보드의 데이터를 별도 인스턴스에서 표시하려면 빌드 후 실행합니다. 자리표시자는 실제 환경에 맞게 레포 밖에서 바꿉니다.

```bash
UPSTREAM_URL='http://<upstream-host>:8790' HOST='<tailscale-ip>' PORT=8791 node .output/server/index.mjs
```

`UPSTREAM_URL`은 경로·쿼리·fragment·사용자 인증 정보가 없는 HTTP(S) 원점이어야 하며 `TOSS_MOCK=1`과 함께 사용할 수 없습니다. 포트폴리오·추이·SSE는 기존 인스턴스에서 전달하며, preview는 토큰·계좌·환경·장부 파일이나 토스 REST/WebSocket을 사용하지 않고 스냅샷도 기록하지 않습니다. `/api/health`는 `proxy`, `mock`, `upstreamReachable`을 반환하며 원본 주소를 노출하지 않습니다.

로고는 preview 서버가 CDN에서 직접 받아 보유종목에 한해 제공합니다. 보유종목 허용 목록은 30초, 로고는 최대 200개를 메모리에 저장합니다(성공 24시간, 실패 1시간). 브라우저는 `/api/logo`에만 접근합니다. 모의 모드에서는 네트워크 없이 단색 SVG를 만들며 두 종목은 기존 배지로 표시합니다.

## 시장 동향과 종목 추이

`/api/market`은 Yahoo의 고정 지수·원유 심볼(`^IXIC`, `^GSPC`, `^KS11`, `CL=F`)만 서버에서 `range=1d&interval=1d`로 조회하며 60초간 캐시합니다. 전일 종가는 `chartPreviousClose`, `previousClose`, 끝에서 두 번째 유효 종가 순서로 사용합니다. 달러/원은 포트폴리오의 기존 중간환율을 재사용합니다. Proxy에서도 Yahoo는 로컬 서버에서 조회하고 환율은 upstream 포트폴리오에서 가져옵니다. 실패하면 마지막 정상 시세를 흐리게 표시하거나 해당 항목을 생략합니다. 시장 가격은 금액 가리기 중에도 유지됩니다. 모바일에서는 2열로 표시하며 항목 수가 홀수이면 마지막 항목이 행 전체를 차지합니다.

`/api/sparklines`는 현재 보유종목의 일봉 200개를 토스 캔들 API에서 조회하고 마지막 30개 종가를 반환합니다. 날짜를 포함한 서버 캐시는 분석 API와 공유합니다. 보유종목은 이미 이를 보유한 토스에만 전달하며 Yahoo 등 제3자에 전달하지 않습니다. 동시 요청은 2개, 성공 캐시는 15분, 실패 캐시는 5분입니다. Proxy는 upstream의 같은 API를 사용하며 미지원·오류 시 빈 결과를 반환합니다. 그래프는 종목명 셀의 심볼 줄 아래 공간을 미리 확보하고 420px 이하에서도 56×18 크기로 표시하여 모바일 표 너비를 유지합니다. 두 기능 모두 모의 모드에서는 외부 네트워크 없이 고정 데이터를 사용합니다.

## 포트폴리오 분석

기존 차트 아래에 수익 기여도, 평가금 비중 히트맵, 벤치마크 비교, 미국 종목 환율 효과, MDD·변동성, 종목 간 상관관계를 표시합니다. `/api/analytics`는 화면 진입 후 별도로 조회하고 30분마다 갱신하며 포트폴리오 응답을 기다리게 하지 않습니다. 금액을 가리면 새 위젯의 축·툴팁·접근성 설명에도 금액이 없고 비율만 남습니다. 기록이 부족한 패널은 높이를 유지합니다.

- 데이터: 토스 일봉은 서버에서 `count=200`, `interval=1d`로 한 번만 조회합니다(페이지 순회 없음). 스파크라인과 캐시·동시 요청 제한 2개를 공유하며 성공 15분, 실패 5분 캐시입니다. 날짜는 국내 KST, 미국 뉴욕 시간 기준입니다. Yahoo는 고정 심볼 `^KS11`, `^GSPC`, `^IXIC`, `KRW=X`만 서버에서 `range=1y&interval=1d`로 조회하여 1시간 캐시하고 실패 시 마지막 정상 이력을 사용합니다. 보유종목은 Yahoo로 보내지 않습니다. 포트폴리오 이력은 기존 장부 스냅샷을 사용합니다.
- 기여도: 오늘·전체 손익은 현재 중간환율로 환산합니다. 기간 손익은 현재 수량을 계속 보유한 추정치로, 양 끝 종가와 해당 날짜 이전의 최근 환율을 사용합니다(환율 누락 시 현재 중간환율). 가린 상태에서는 시작 주식 평가금 대비 %p, 전체는 총 매입금액 대비 %p입니다. 환율 분해는 가격 효과 `수량×(P1−P0)×FX0`와 환율 효과 `수량×P1×(FX1−FX0)`의 합입니다. 과거 데이터가 없으면 생략하며 평균 매입 환율을 알 수 없어 매입 이후 분해는 제공하지 않습니다.
- 벤치마크·위험: 스냅샷의 일별 `평가손익 변화 / 전일 주식 평가금`을 연결하여 입출금에 따른 원금 변화를 제외합니다. 매도로 확정된 실현손익은 포착하지 못합니다. 지수는 스냅샷 날짜 이전의 최근 종가를 맞춰 같은 시작일 0%로 환산하며 현지 통화 가격 기준으로 배당은 제외합니다. MDD는 기간 고점 대비 최대 낙폭입니다. 변동성은 일별 수익률의 표본 표준편차×√252이며 종목에는 로그 수익률을 사용합니다(최소 20개). 전체 종목 이력은 최대 약 200거래일입니다.
- 상관관계: 최근 60/120거래일의 일별 단순 수익률을 쌍별 공통 날짜로 맞춰 Pearson 계수를 계산합니다(최소 20개). 한국·미국의 마감 시각 차이로 같은 날짜의 시장 간 상관관계가 낮게 측정될 수 있습니다. 일봉 기반 분석은 배당·주식분할 등 기업행동과 과거 수량 변화를 보정하지 않습니다.

모의 모드는 외부 호출 없이 결정적인 200거래일 종가·지수·환율과 원금 증가를 포함한 90일 스냅샷을 제공합니다. Proxy는 새 API를 upstream으로 전달하며 10초 제한·오류·미지원 시 빈 유효 응답을 반환합니다.

## 목표 비중과 리밸런싱

분석 섹션의 `리밸런싱`은 현금 포함 총자산 대비 목표 비중과 차이를 보여주는 참고용 계산기이며 주문 기능은 없습니다. `목표 편집`에서 0~100%, 소수 둘째 자리까지 입력하고 합계는 100% 이하로 저장합니다. 빈칸은 미지정으로 계산에서 제외되며, `0`은 명시적인 목표입니다. 순 필요 현금은 목표를 지정한 보유종목의 매수 금액에서 매도 금액을 뺀 값이고, 현금 행은 목표 잔액 차이입니다. 금액을 가리면 금액·수량 대신 비중·차이·방향만 표시합니다.

목표는 서버의 `TARGET_WEIGHTS_PATH`에 저장합니다(`~` 확장 지원). 기본 위치는 `PORTFOLIO_LEDGER_PATH`와 같은 디렉터리의 `targets.json`입니다. 디렉터리를 레포 밖에 준비하고, 이 파일은 커밋하지 마세요(`targets.json`은 gitignore 대상). 저장은 파일 락과 원자적 교체를 사용하며 권한은 `0600`입니다. 손상된 파일은 오류를 반환하고 그대로 보존하므로 서버에서 확인해야 합니다. 목표 내용은 로그나 브라우저 저장소에 기록하지 않습니다. Mock은 결정적인 초기 목표를 메모리에서만 편집하며 재시작하면 초기화됩니다. Proxy preview는 조회만 가능합니다.

## GX10 배포

레포를 `~/apps/toss-portfolio-dashboard`에 준비한 후 GX10에서 실행합니다. 네이티브 바인딩 때문에 다른 아키텍처에서 빌드한 결과물을 복사하지 않습니다.

```bash
cd ~/apps/toss-portfolio-dashboard
./scripts/build-on-gx10.sh
./scripts/install-service.sh
```

빌드 스크립트는 Node 24로 `npm ci`와 mock 빌드를 실행합니다. mock 설정은 빌드 프로세스에만 적용되며 실제 서비스는 환경 파일의 런타임 설정을 사용합니다.

설치 스크립트는 유닛을 복사하고, `~/.config/toss-dashboard.env`가 없을 때만 설정 예제를 mode 600으로 복사한 뒤 `daemon-reload`합니다. 기본 실행은 서비스를 시작하거나 활성화하지 않습니다. 이 환경 파일의 `HOST=<tailscale-ip>`에서 `<tailscale-ip>`를 `tailscale ip -4`로 확인한 실제 주소로 바꾸고 경로와 Tailscale 연결을 확인한 뒤 직접 시작합니다. 배포 HOST는 이 레포 밖의 환경 파일에만 설정하며 유닛에는 넣지 않습니다.

`NODE_ENV=production`에서는 HOST가 미설정·빈 값이거나 `0.0.0.0`, `::`, `[::]`, `<...>` 자리표시자이면 HTTP 수신 전에 시작을 거부합니다. 이 검사는 프로덕션의 `TOSS_MOCK=1` 실행에도 적용됩니다. 개발·테스트 모드에는 적용하지 않습니다.

```bash
systemctl --user enable --now toss-dashboard
systemctl --user status toss-dashboard
journalctl --user -u toss-dashboard -n 50
```

명시적으로 시작까지 원하면 `./scripts/install-service.sh --start`를 사용할 수 있습니다. 접속 주소 형식은 `http://<tailscale-ip>:8790` 또는 `http://<tailscale-host>:8790`이며, 꺾쇠 부분을 배포 장비의 Tailscale IP 또는 호스트명으로 바꿉니다. 유닛은 환경 파일의 HOST로 바인드하며 메모리 상한 768M, MemoryHigh 640M, Node 힙 384M, CPU 100%를 적용합니다. 재부팅 후 실행하려면 서비스 계정의 사용자 linger 설정을 확인하세요.

## 검증과 보안

```bash
export PATH="$HOME/.local/opt/node24/bin:$PATH"
export TOSS_MOCK=1
npm run typecheck
npm test
npx --no-install biome check src tests
npm run build
./scripts/secret-scan.sh
rg -l '[/~]invest/|TOSS_(ENV|TOKEN|ACCOUNT)_PATH|PORTFOLIO_LEDGER_PATH|openapi(-ws)?\.tossinvest\.com|createPortfolioService|createTokenStore|src/server/|TanStackDevtools|static\.toss\.im|UPSTREAM_URL|finance\.yahoo' .output/public
```

마지막 검색은 결과가 없어야 합니다. 실시간 통합 테스트는 가짜 WebSocket 서버를 loopback에 바인드하므로 포트 바인드를 막는 샌드박스에서는 해당 테스트가 실패합니다. 나머지 검사와 실제 CI 환경의 전체 테스트는 통과해야 합니다.

`scripts/check-private-hosts.sh`는 추적 파일의 Tailscale CGNAT IP와 MagicDNS 호스트명을 검사하고 발견 위치를 출력합니다. 수동 보안 스크립트와 CI의 checkout 직후 단계에서 실행합니다. gitleaks v8.30.1을 PATH에 준비하면 수동 스크립트로 전체 git 히스토리의 시크릿도 검사합니다. pre-commit 사용 환경에서는 `pre-commit install`로 커밋 전 검사도 활성화합니다. CI는 고정 버전 gitleaks 아카이브의 SHA-256을 검증한 뒤 전체 히스토리를 검사하고, Node 24·mock 모드로 설치·타입 검사·테스트·Biome·빌드를 실행합니다.

토큰은 유효하면 재사용하며, 만료 시에만 파일 락 안에서 갱신합니다. 기존 toss.py는 이 락을 사용하지 않으므로 만료 직전 동시 실행에는 작은 경쟁 구간이 남습니다. 이 레포는 투자봇을 수정하지 않습니다. 로그는 `redact()`를 거치며 헤더를 기록하지 않습니다. 계좌 캐시·장부·인증 파일은 gitignore 대상입니다.

세부 동작과 운영 기준: [docs/DESIGN.md](docs/DESIGN.md).
