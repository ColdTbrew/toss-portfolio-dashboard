# 내 포트폴리오

토스증권 국내·해외 보유종목, 현금, 수익률을 한 화면에서 확인하는 **조회 전용** 대시보드입니다. TanStack Start · React 19 · Tailwind v4 · Recharts · Node 24를 사용합니다. GX10에서 빌드하고 Tailscale 내부에서 접속합니다.

거래를 실행하는 기능은 없습니다. 토스 REST 호출은 인증, 계좌 목록, 보유종목, 현금, 환율 조회만 허용하며, WebSocket은 국내·미국 체결 구독만 사용합니다. 서버의 연결 하나를 여러 브라우저가 SSE로 공유합니다. 로컬 토큰·계좌 캐시와 일별 장부는 저장하지만 토스 자산을 변경하지 않습니다. 허용 경로와 요청 메서드는 자동 테스트로 검사합니다.

## 개발: 모의 데이터

Node 24와 프로젝트 의존성이 필요합니다. 설치 후 다음 명령으로 실행합니다.

```bash
export PATH="$HOME/.local/opt/node24/bin:$PATH"
npm ci
npm run dev:mock
```

접속 주소는 `http://127.0.0.1:3100`입니다. `TOSS_MOCK=1`에서는 가상 국내·해외 종목, 60일 추이, 초당 틱을 사용합니다. 토스 네트워크 호출이나 `~/invest` 파일 읽기·쓰기는 없습니다. 브라우저는 대시보드 자체의 API/SSE에만 연결합니다. 실제 개발 서버 실행은 접근 가능한 환경에서 직접 진행하세요.

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
| `SNAPSHOT_ENABLED` | `1` | `0`이면 일별 기록 중단; mock에서는 항상 중단 |
| `SNAPSHOT_TIME_KST` | `16:10` | 해당 시각 이후 첫 성공 갱신 때 하루 1회 기록 |
| `REFRESH_HOLDINGS_SEC` | `30` | 보유종목 갱신 주기 |
| `REFRESH_CASH_FX_SEC` | `60` | 현금·환율 갱신 주기 |
| `HOST` / `PORT` | 배포 유닛에서 지정 | `<tailscale-ip>` / `8790` |

서버 환경의 `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`도 지원하지만, 배포 예제에는 경로만 둡니다. 값을 클라이언트용 환경 변수로 넣거나 레포·로그·스크린샷에 남기지 마세요.

## GX10 배포

레포를 `~/apps/toss-portfolio-dashboard`에 준비한 후 GX10에서 실행합니다. 네이티브 바인딩 때문에 다른 아키텍처에서 빌드한 결과물을 복사하지 않습니다.

```bash
cd ~/apps/toss-portfolio-dashboard
./scripts/build-on-gx10.sh
./scripts/install-service.sh
```

빌드 스크립트는 Node 24로 `npm ci`와 mock 빌드를 실행합니다. mock 설정은 빌드 프로세스에만 적용되며 실제 서비스는 환경 파일의 런타임 설정을 사용합니다.

설치 스크립트는 유닛을 복사하고, `~/.config/toss-dashboard.env`가 없을 때만 경로 예제를 mode 600으로 복사한 뒤 `daemon-reload`합니다. 기본 실행은 서비스를 시작하거나 활성화하지 않습니다. 경로와 Tailscale 연결을 확인한 뒤 직접 시작합니다.

```bash
systemctl --user enable --now toss-dashboard
systemctl --user status toss-dashboard
journalctl --user -u toss-dashboard -n 50
```

명시적으로 시작까지 원하면 `./scripts/install-service.sh --start`를 사용할 수 있습니다. 접속은 `http://<tailscale-ip>:8790` 또는 `http://<tailscale-host>:8790`입니다. 유닛은 Tailscale IP만 바인드하며 메모리 상한 768M, MemoryHigh 640M, Node 힙 384M, CPU 100%를 적용합니다. 재부팅 후 실행하려면 사용자 linger가 필요하며 GX10의 coldbrew 계정은 이미 설정되어 있습니다.

## 검증과 보안

```bash
export PATH="$HOME/.local/opt/node24/bin:$PATH"
export TOSS_MOCK=1
npm run typecheck
npm test
npx --no-install biome check src tests
npm run build
./scripts/secret-scan.sh
rg -l '[/~]invest/|TOSS_(ENV|TOKEN|ACCOUNT)_PATH|PORTFOLIO_LEDGER_PATH|openapi(-ws)?\.tossinvest\.com|createPortfolioService|createTokenStore|src/server/|TanStackDevtools' .output/public
```

마지막 검색은 결과가 없어야 합니다. 실시간 통합 테스트는 가짜 WebSocket 서버를 loopback에 바인드하므로 포트 바인드를 막는 샌드박스에서는 해당 테스트가 실패합니다. 나머지 검사와 실제 CI 환경의 전체 테스트는 통과해야 합니다.

gitleaks v8.30.1을 PATH에 준비하면 수동 스크립트로 전체 git 히스토리를 검사합니다. pre-commit 사용 환경에서는 `pre-commit install`로 커밋 전 검사도 활성화합니다. CI는 고정 버전 gitleaks 아카이브의 SHA-256을 검증한 뒤 전체 히스토리를 검사하고, Node 24·mock 모드로 설치·타입 검사·테스트·Biome·빌드를 실행합니다.

토큰은 유효하면 재사용하며, 만료 시에만 파일 락 안에서 갱신합니다. 기존 toss.py는 이 락을 사용하지 않으므로 만료 직전 동시 실행에는 작은 경쟁 구간이 남습니다. 이 레포는 투자봇을 수정하지 않습니다. 로그는 `redact()`를 거치며 헤더를 기록하지 않습니다. 계좌 캐시·장부·인증 파일은 gitignore 대상입니다.

세부 동작과 운영 기준: [docs/DESIGN.md](docs/DESIGN.md).
