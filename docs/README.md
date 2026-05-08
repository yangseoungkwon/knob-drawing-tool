# Dual Knob Playground

노브 입력 패턴을 웹 인터랙션으로 검증하는 멀티페이지 프로토타입입니다.

## 폴더 구조

- `pages/`: 화면 파일 (`index`, `knob-drawing`, `maze`)
- `scripts/`: 기능 스크립트 (`knob.js`, `maze.js`)
- `styles/`: 스타일 파일 (`style.css`, `maze.css`)
- `assets/`: 아이콘/가이드 이미지
- `docs/`: 문서

## 페이지 구성

- `pages/index.html`: 홈 페이지
- `pages/knob-drawing.html`: 노브 드로잉 서브페이지
- `pages/maze.html`: 노브 매핑형 미로 탈출게임 서브페이지

## 실행 방법

프로젝트 루트에서 정적 서버를 실행:

```bash
python3 -m http.server 8080
```

브라우저 접속:

- 홈: `http://localhost:8080/pages/index.html`
- 노브 드로잉: `http://localhost:8080/pages/knob-drawing.html`
- 미로 게임: `http://localhost:8080/pages/maze.html`

## RP2040 펌웨어 시작점

- 듀얼 노브 스케치: `firmware/dual_knob_rp2040/dual_knob_rp2040.ino`
- 기본 매핑:
  - 왼쪽 노브 회전 -> Y 이동
  - 오른쪽 노브 회전 -> X 이동
  - 왼쪽 버튼 -> 좌클릭
  - 오른쪽 버튼 -> 우클릭
  - NeoPixel(`GPIO29`) -> 상태 LED

## 아이콘 출처

- 확장 화살표 아이콘: [확장 화살표 아이콘 제작자: redempticon - Flaticon](https://www.flaticon.com/kr/free-icons/-)
