/**
 * 모니터링 dump(데모) 기록에 붙일 실제 촬영 사진 풀과, 그 사진의 **병변 오버레이**.
 * Metro는 require() 경로를 정적으로 분석해야 하므로 동적 경로 대신 배열로 나열한다.
 * - ATOPIC_PHOTOS / ATOPIC_OVERLAYS: 프리셋 폴더 "팔 건선" 전용
 * - CHEEK_PHOTOS  / CHEEK_OVERLAYS : 프리셋 폴더 "머리 주사"·"얼굴 아토피" 전용
 * - TORSO_PHOTOS  / TORSO_OVERLAYS : 프리셋 폴더 "몸통 아토피" 전용 (실사진 1장을 매 회차 재사용)
 *
 * 오버레이는 **tools/bake_dump_overlays.py로 미리 구운 것**이다. 앱 안에서 그때그때 세그를
 * 돌려 보려 했지만, 데모 기록이 40장을 넘어 시작할 때 다 돌릴 수 없고 화면에 보일 때만 돌리면
 * 늦게 뜨거나 실패했을 때 원본만 남는다 — 어느 쪽이든 사용자에게는 기능이 없는 것으로 보인다.
 * 사진도 모델도 고정이라 결과가 고정이니, 미리 굽는 편이 맞다.
 *
 * ⚠️ 사진과 오버레이는 **같은 순서·같은 개수**여야 한다 (i번째 사진의 오버레이가 i번째다).
 *    사진을 더하거나 빼면 굽는 스크립트를 다시 돌리고 여기 목록도 함께 고칠 것.
 */
export const ATOPIC_PHOTOS = [
  require('../../assets/dump_photos/atopic/01.jpg'),
  require('../../assets/dump_photos/atopic/02.jpg'),
  require('../../assets/dump_photos/atopic/03.jpg'),
  require('../../assets/dump_photos/atopic/04.jpg'),
  require('../../assets/dump_photos/atopic/05.jpg'),
  require('../../assets/dump_photos/atopic/06.jpg'),
  require('../../assets/dump_photos/atopic/07.jpg'),
  require('../../assets/dump_photos/atopic/08.jpg'),
  require('../../assets/dump_photos/atopic/09.jpg'),
  require('../../assets/dump_photos/atopic/10.jpg'),
  require('../../assets/dump_photos/atopic/11.jpg'),
  require('../../assets/dump_photos/atopic/12.jpg'),
  require('../../assets/dump_photos/atopic/13.jpg'),
  require('../../assets/dump_photos/atopic/14.jpg'),
];

export const CHEEK_PHOTOS = [
  require('../../assets/dump_photos/cheek/01.jpg'),
  require('../../assets/dump_photos/cheek/02.jpg'),
  require('../../assets/dump_photos/cheek/03.jpg'),
  require('../../assets/dump_photos/cheek/04.jpg'),
  require('../../assets/dump_photos/cheek/05.jpg'),
  require('../../assets/dump_photos/cheek/06.jpg'),
  require('../../assets/dump_photos/cheek/07.jpg'),
];

export const ATOPIC_OVERLAYS = [
  require('../../assets/dump_overlays/atopic/01.jpg'),
  require('../../assets/dump_overlays/atopic/02.jpg'),
  require('../../assets/dump_overlays/atopic/03.jpg'),
  require('../../assets/dump_overlays/atopic/04.jpg'),
  require('../../assets/dump_overlays/atopic/05.jpg'),
  require('../../assets/dump_overlays/atopic/06.jpg'),
  require('../../assets/dump_overlays/atopic/07.jpg'),
  require('../../assets/dump_overlays/atopic/08.jpg'),
  require('../../assets/dump_overlays/atopic/09.jpg'),
  require('../../assets/dump_overlays/atopic/10.jpg'),
  require('../../assets/dump_overlays/atopic/11.jpg'),
  require('../../assets/dump_overlays/atopic/12.jpg'),
  require('../../assets/dump_overlays/atopic/13.jpg'),
  require('../../assets/dump_overlays/atopic/14.jpg'),
];

export const CHEEK_OVERLAYS = [
  require('../../assets/dump_overlays/cheek/01.jpg'),
  require('../../assets/dump_overlays/cheek/02.jpg'),
  require('../../assets/dump_overlays/cheek/03.jpg'),
  require('../../assets/dump_overlays/cheek/04.jpg'),
  require('../../assets/dump_overlays/cheek/05.jpg'),
  require('../../assets/dump_overlays/cheek/06.jpg'),
  require('../../assets/dump_overlays/cheek/07.jpg'),
];

/*
  ⚠️ 실제 사진 1장뿐이라 배열 길이가 1이다. dumpPhotos를 쓰는 쪽(store.js의
  photoAt = (photoStart + i) % photos.length)이 어떤 회차든 나머지 연산으로 항상 0번을
  가리키므로, 모든 회차가 같은 사진 위에 그 회차의 오버레이 도형만 갈아 낀 것처럼 보인다.
  실제로는 오버레이도 이 한 장에서 구운 것 하나뿐이라 그 문제도 없다 — 나중에 촬영분이
  쌓이면 여기 배열에 이어 붙이고 tools/bake_dump_overlays.py를 다시 돌리면 된다.
*/
export const TORSO_PHOTOS = [
  require('../../assets/dump_photos/torso/01.jpg'),
];

export const TORSO_OVERLAYS = [
  require('../../assets/dump_overlays/torso/01.jpg'),
];
