// 온디바이스 추론 (서버 없이) — react-native-fast-tflite로 세그멘테이션 + 중증도 실행
import { Image } from 'react-native';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { toByteArray, fromByteArray } from 'base64-js';
import jpeg from 'jpeg-js';

// jpeg-js encode()는 Node의 Buffer.from()을 사용 → RN(Hermes)엔 전역 Buffer가 없어 크래시.
// encode 반환부(Buffer.from(byteArray))만 Uint8Array로 돌려주면 됨.
if (typeof global !== 'undefined' && typeof global.Buffer === 'undefined') {
  global.Buffer = { from: (a) => (a instanceof Uint8Array ? a : new Uint8Array(a)) };
}

const MEAN = [0.485, 0.456, 0.406];
const STD  = [0.229, 0.224, 0.225];

const SEV_HEADS = [
  { key: 'iga_grade',       name: 'IGA 등급',   classes: ['Clear', 'Almost Clear', 'Mild', 'Moderate', 'Severe'] },
  { key: 'erythema',        name: '홍반',       classes: ['None', 'Mild', 'Moderate', 'Severe'] },
  { key: 'papulation',      name: '구진',       classes: ['None', 'Mild', 'Moderate', 'Severe'] },
  { key: 'excoriation',     name: '상처(찰상)', classes: ['None', 'Mild', 'Moderate', 'Severe'] },
  { key: 'lichenification', name: '태선화',     classes: ['None', 'Mild', 'Moderate', 'Severe'] },
];
const GRADE_KO = {
  Clear: '깨끗', 'Almost Clear': '거의 깨끗',
  None: '없음', Mild: '경증', Moderate: '중등도', Severe: '중증',
};

// fast-tflite는 지연 로딩 (앱 시작 시 크래시 방지)
let _lib = null;
function lib() {
  if (!_lib) _lib = require('react-native-fast-tflite');
  return _lib;
}

// ---- 모델 로드 (1회 후 캐시) ----
let _sev = null, _seg = null;
let _device = 'CPU';
async function loadOne(mod, label, onProgress) {
  const { loadTensorflowModel } = lib();
  const asset = Asset.fromModule(mod);
  onProgress && onProgress(`${label} 모델 다운로드 중...`);
  await asset.downloadAsync();
  const url = asset.localUri || asset.uri;
  onProgress && onProgress(`${label} 모델 로딩 중...`);
  try {
    _device = 'CPU';
    return await loadTensorflowModel({ url }, []);   // CPU (GPU 델리게이트는 ConvNeXt에서 hang 가능)
  } catch (e) {
    throw new Error(`${label} 로드 실패\nurl=${url}\n:: ${e?.message}`);
  }
}
// 세그: EffB0-UNet++ @384 (모바일 최적, 12MB, NCHW). 중증도: PVTv2-B0 @512 (6.8MB, NCHW)
const ENABLE_SEG = true;
const SEG_SIZE = 512;   // EffB0-UNet++ 입력 (512)
const SEV_SIZE = 512;   // PVTv2-B0 입력 (512)
async function getSegModel(onProgress) {   // 병변 세그(EffB0-UNet++ @512)
  if (_seg) return _seg;
  _seg = await loadOne(require('../../assets/models/seg_effb0_unetpp_512_fp16.tflite'), '병변검출', onProgress);
  return _seg;
}
async function getModels(onProgress) {
  if (_sev && (_seg || !ENABLE_SEG)) return { sev: _sev, seg: _seg };
  if (ENABLE_SEG) await getSegModel(onProgress);
  if (!_sev) _sev = await loadOne(require('../../assets/models/sev_pvt_v2_b0_corn_crop_area_512_fp16.tflite'), '중증도', onProgress);
  return { sev: _sev, seg: _seg };
}

// 피부 세그(EffB0-UNet++ @512) — 면적추적 전용, 지연 로딩(일반 진단은 메모리 영향 없음)
// I/O: 입력 NCHW [1,3,512,512], 출력 [1,512,512,1] 1채널 로짓(logit>0 = 피부, NCHW와 메모리 동일)
let _skin = null;
async function getSkinModel(onProgress) {
  if (_skin) return _skin;
  _skin = await loadOne(require('../../assets/models/seg_skin_effb0_unetpp_512_fp16.tflite'), '피부검출', onProgress);
  return _skin;
}

// 원본 이미지 크기 (크롭 좌표 환산용)
function imageSize(uri) {
  return new Promise((resolve) => {
    Image.getSize(uri, (w, h) => resolve({ w, h }), () => resolve(null));
  });
}

// 가이드 박스(중앙 정사각형) 크롭 — boxFrac: 짧은 변 대비 비율(0~1). 크롭 uri 반환(실패/전체면 원본).
// ⚠️ EXIF 방향 때문에 Image.getSize와 manipulate의 좌표계가 다를 수 있어,
//    manipulate가 재인코딩한 이미지의 자체 width/height로 크롭한다(방향 일치 보장).
export async function cropToBox(uri, boxFrac = 0.8) {
  try {
    const f = Math.max(0.3, Math.min(1, boxFrac));
    if (f >= 0.999) return uri;                       // 전체면 크롭 안 함
    const base = await manipulateAsync(uri, [], { compress: 1, format: SaveFormat.JPEG }); // EXIF 반영 upright
    const w = base.width, h = base.height;
    if (!w || !h) return uri;
    const side = Math.round(f * Math.min(w, h));
    const ox = Math.round((w - side) / 2);
    const oy = Math.round((h - side) / 2);
    const cr = await manipulateAsync(base.uri,
      [{ crop: { originX: ox, originY: oy, width: side, height: side } }],
      { compress: 1, format: SaveFormat.JPEG });
    return cr.uri;
  } catch (e) { return uri; }
}

// 이미지 → size×size RGBA
async function imageToRGBA(uri, size) {
  const m = await manipulateAsync(uri, [{ resize: { width: size, height: size } }],
    { compress: 1, format: SaveFormat.JPEG, base64: true });
  const bytes = toByteArray(m.base64);
  return jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true }); // {data,width,height}
}

// 정규화 텐서 (NHWC / NCHW)
function toNHWC(rgba, size) {
  const hw = size * size, out = new Float32Array(hw * 3);
  for (let i = 0; i < hw; i++)
    for (let c = 0; c < 3; c++)
      out[i * 3 + c] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  return out;
}
function toNCHW(rgba, size) {
  const hw = size * size, out = new Float32Array(3 * hw);
  for (let i = 0; i < hw; i++)
    for (let c = 0; c < 3; c++)
      out[c * hw + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  return out;
}

// 중증도 5개 출력이 tflite에서 물리적으로 뒤섞여 반환됨.
// 출력 이름 'StatefulPartitionedCall:N'의 N이 원래(의미) 인덱스 → 이름으로 재정렬.
// 반환 order[semanticIdx] = physicalIdx
function sevOutOrder(model) {
  const outs = model.outputs || [];
  const order = new Array(SEV_HEADS.length).fill(-1);
  outs.forEach((t, phys) => {
    const m = /:(\d+)\s*$/.exec(t && t.name ? t.name : '');
    if (m) { const s = parseInt(m[1], 10); if (s >= 0 && s < order.length) order[s] = phys; }
  });
  if (order.some(v => v < 0)) return SEV_HEADS.map((_, i) => i);  // 파싱 실패 → 그대로
  return order;
}

// CORN 서수 디코딩
function cornLevel(logits) {
  let cum = 1, level = 0;
  for (let i = 0; i < logits.length; i++) {
    cum *= 1 / (1 + Math.exp(-logits[i]));
    if (cum > 0.5) level++; else break;
  }
  return level;
}

// 라이브 정렬 체크용 — 피부 세그만 돌려 프레임 내 피부 점유율%만 빠르게 반환.
export async function skinOccupancyOnDevice(uri) {
  const skin = await getSkinModel();
  const S = SEG_SIZE;
  const img = await imageToRGBA(uri, S);
  const out = await skin.run([toNCHW(img.data, S).buffer]);
  const logits = new Float32Array(out[0]);
  const HW = S * S;
  let count = 0;
  for (let p = 0; p < HW; p++) if (logits[p] > 0) count++;
  return Math.round(1000 * count / HW) / 10;
}

// 구도 일치 판별용 — 이미지를 N×N 흑백으로 축소해 평균0·단위노름 벡터(시그니처) 반환.
// 두 시그니처의 내적 = 정규화 상관도(-1~1). 모델 불필요, 매우 경량.
export async function imageSignature(uri, N = 32) {
  const img = await imageToRGBA(uri, N);
  const d = img.data, n = N * N;
  const g = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) { const j = i * 4; g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]; mean += g[i]; }
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) { g[i] -= mean; ss += g[i] * g[i]; }
  const norm = Math.sqrt(ss) || 1;
  for (let i = 0; i < n; i++) g[i] /= norm;
  return g;
}

// 라이브 정렬 큐용 — 병변+피부 세그로 {피부점유율, 병변∩피부 픽셀}만 반환(오버레이 X, 경량).
// 병변 픽셀은 거리에 따라 변하므로(피부가 포화되는 몸통에서도) 거리 큐의 기준으로 씀.
export async function alignSignalsOnDevice(uri) {
  const seg = await getSegModel();
  const skin = await getSkinModel();
  const S = SEG_SIZE;
  const img = await imageToRGBA(uri, S);
  const inBuf = toNCHW(img.data, S).buffer;
  const lesion = maskFromLogits(new Float32Array((await seg.run([inBuf]))[0]), S);
  const skinM = maskFromLogits(new Float32Array((await skin.run([inBuf]))[0]), S);
  const HW = S * S;
  let skinCount = 0, lesionOnSkin = 0;
  for (let p = 0; p < HW; p++) {
    if (skinM.mask[p]) { skinCount++; if (lesion.mask[p]) lesionOnSkin++; }
  }
  return { skin_occupancy: Math.round(1000 * skinCount / HW) / 10, lesion_on_skin: lesionOnSkin };
}

// 세그 1채널 로짓 → 마스크(logit>0) + 픽셀수 + bbox
function maskFromLogits(logits, S) {
  const HW = S * S;
  const mask = new Uint8Array(HW);
  let count = 0, minX = S, minY = S, maxX = 0, maxY = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = y * S + x;
      if (logits[p] > 0) {
        mask[p] = 1; count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { mask, count, bbox: count > 10 ? { minX, minY, maxX, maxY } : null };
}

// ---- 면적추적: 원거리 사진의 상대면적 측정 (거리 불변) ----
// area_ratio = 병변픽셀 / 피부픽셀 × 100  (프레임 내 피부 대비 병변 비율)
// 병변 세그 + 피부 세그를 같은 원거리 이미지(@512)에 실행. 서버 없이 온디바이스.
// 반환값의 lesion_pixels/bodypart_pixels/area_ratio를 tracking.js saveSession에 그대로 넣으면 됨.
export async function measureAreaOnDevice(overviewUri, onProgress) {
  const prof = [];
  let _t = Date.now();
  const mark = (name) => { const now = Date.now(); prof.push({ stage: name, ms: now - _t }); _t = now; };

  const seg  = await getSegModel(onProgress);    // 병변 세그(면적측정엔 중증도 모델 불필요)
  const skin = await getSkinModel(onProgress);   // 피부 세그 지연 로드
  mark('모델 로드');

  const S = SEG_SIZE;
  const img = await imageToRGBA(overviewUri, S);
  const inBuf = toNCHW(img.data, S).buffer;
  mark('이미지 준비/전처리');

  onProgress && onProgress('병변 영역 검출 중...');
  const lesionOut = await seg.run([inBuf]);
  const lesion = maskFromLogits(new Float32Array(lesionOut[0]), S);
  mark('병변 세그');

  onProgress && onProgress('피부 영역 검출 중...');
  const skinOut = await skin.run([inBuf]);
  const skinM = maskFromLogits(new Float32Array(skinOut[0]), S);
  mark('피부 세그');

  const HW = S * S;
  const lesion_pixels = lesion.count;     // 원시 병변 픽셀(참고)
  // 분모 = 검출된 피부, 분자 = 병변∩피부. 피부 밖 병변(책상 등 배경 허위검출)은 면적에서 제외.
  // 실제 아토피 사진은 병변이 피부 안(outside 0%)이라 결과 동일 — 배경 FP만 걸러짐.
  let skinCount = 0, lesionOnSkin = 0, lesionOutside = 0;
  for (let p = 0; p < HW; p++) {
    const s = skinM.mask[p], l = lesion.mask[p];
    if (s) skinCount++;
    if (l && s) lesionOnSkin++;
    else if (l) lesionOutside++;
  }
  const bodypart_pixels = skinCount;      // = 프레임 내 피부 픽셀 = 분모
  const area_ratio = skinCount > 0
    ? Math.round(1000 * lesionOnSkin / skinCount) / 10          // 병변∩피부 / 피부 ×100, 0~100
    : null;
  const lesion_outside_skin = lesion_pixels > 0
    ? Math.round(1000 * lesionOutside / lesion_pixels) / 10     // 병변 중 피부밖 비율%
    : 0;

  // ---- 품질 원신호 (판정은 quality.js에서) ----
  // 블러: 그레이스케일 라플라시안 분산(낮을수록 흐림). Welford 온라인 분산.
  const rgbaD = img.data;
  const gray = new Float32Array(HW);
  for (let p = 0; p < HW; p++) {
    const i = p * 4;
    gray[p] = 0.299 * rgbaD[i] + 0.587 * rgbaD[i + 1] + 0.114 * rgbaD[i + 2];
  }
  let lapMean = 0, lapM2 = 0, lapN = 0;
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const p = y * S + x;
      const lap = 4 * gray[p] - gray[p - 1] - gray[p + 1] - gray[p - S] - gray[p + S];
      lapN++; const d = lap - lapMean; lapMean += d / lapN; lapM2 += d * (lap - lapMean);
    }
  }
  const laplacian_var = lapN > 1 ? Math.round(lapM2 / lapN) : 0;

  // 잘림: 프레임 테두리 픽셀 중 피부/병변 비율. 병변이 경계에 걸리면 면적 과소측정.
  let borderTotal = 0, borderSkin = 0, borderLesion = 0;
  for (let x = 0; x < S; x++) {
    borderTotal += 2;
    const tp = x, bp = (S - 1) * S + x;
    if (skinM.mask[tp]) borderSkin++; if (lesion.mask[tp]) borderLesion++;
    if (skinM.mask[bp]) borderSkin++; if (lesion.mask[bp]) borderLesion++;
  }
  for (let y = 1; y < S - 1; y++) {
    borderTotal += 2;
    const lp = y * S, rp = y * S + S - 1;
    if (skinM.mask[lp]) borderSkin++; if (lesion.mask[lp]) borderLesion++;
    if (skinM.mask[rp]) borderSkin++; if (lesion.mask[rp]) borderLesion++;
  }
  const skin_edge_frac   = borderTotal > 0 ? Math.round(1000 * borderSkin / borderTotal) / 10 : 0;
  const lesion_edge_frac = borderTotal > 0 ? Math.round(1000 * borderLesion / borderTotal) / 10 : 0; // 병변 경계걸림%

  // 오버레이(Phase 5 마스크 토글용): 피부=파랑 옅게, 병변=초록 강조 + 노란 외곽
  const rgba = img.data, ov = new Uint8Array(rgba);
  for (let p = 0; p < HW; p++) {
    const i = p * 4;
    if (skinM.mask[p]) {
      ov[i]     = (rgba[i]     * 0.82 + 60  * 0.18) | 0;
      ov[i + 1] = (rgba[i + 1] * 0.82 + 130 * 0.18) | 0;
      ov[i + 2] = (rgba[i + 2] * 0.82 + 246 * 0.18) | 0;
    }
    if (lesion.mask[p]) {
      ov[i]     = (rgba[i]     * 0.5 + 46  * 0.5) | 0;
      ov[i + 1] = (rgba[i + 1] * 0.5 + 204 * 0.5) | 0;
      ov[i + 2] = (rgba[i + 2] * 0.5 + 113 * 0.5) | 0;
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = y * S + x;
      if (!lesion.mask[p]) continue;
      const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1 ||
        !lesion.mask[p - 1] || !lesion.mask[p + 1] || !lesion.mask[p - S] || !lesion.mask[p + S];
      if (edge) { const i = p * 4; ov[i] = 255; ov[i + 1] = 220; ov[i + 2] = 0; }
    }
  }
  const enc = jpeg.encode({ data: ov, width: S, height: S }, 85);
  const overlayUri = 'data:image/jpeg;base64,' + fromByteArray(enc.data);

  // 피부 세그 단독 오버레이 (피부=파랑 뚜렷)
  const skinOv = new Uint8Array(rgba);
  for (let p = 0; p < HW; p++) {
    if (!skinM.mask[p]) continue;
    const i = p * 4;
    skinOv[i]     = (rgba[i]     * 0.5 + 60  * 0.5) | 0;
    skinOv[i + 1] = (rgba[i + 1] * 0.5 + 140 * 0.5) | 0;
    skinOv[i + 2] = (rgba[i + 2] * 0.5 + 246 * 0.5) | 0;
  }
  const skinEnc = jpeg.encode({ data: skinOv, width: S, height: S }, 85);
  const skinOverlayUri = 'data:image/jpeg;base64,' + fromByteArray(skinEnc.data);
  mark('오버레이 생성');

  const totalMs = prof.reduce((a, b) => a + b.ms, 0);
  return {
    lesion_pixels,                       // 원시 병변 픽셀
    lesion_on_skin: lesionOnSkin,        // 병변∩피부 (면적 계산 분자)
    bodypart_pixels,                     // 검출 피부 픽셀 (분모)
    area_ratio,                          // 병변∩피부 / 피부 ×100 (%), 0~100, 피부 0이면 null
    lesion_outside_skin,                 // 병변 중 피부밖 비율% (높으면 피부검출 실패/비피부 피사체)
    skin_occupancy: Math.round(1000 * bodypart_pixels / HW) / 10,  // 프레임 내 피부 점유율%
    laplacian_var,                       // 선명도(라플라시안 분산) — 절대비교 불가, baseline 대비만
    skin_edge_frac,                      // 테두리 피부 비율%(참고)
    lesion_edge_frac,                    // 병변 경계걸림%(높으면 병변 잘림 = 면적 과소측정)
    lesion_bbox: lesion.bbox,            // 512 그리드 기준
    overlayUri,                          // 병변+피부 마스크 시각화(data URI)
    skinOverlayUri,                      // 피부 세그 단독 시각화(data URI)
    grid: S,
    metrics: { total_ms: totalMs, profile: prof, device: `On-Device (${_device})` },
  };
}

export async function diagnoseOnDevice(imageUri, useSegmentation = false, onProgress) {
  // ---- 단계별 프로파일링 ----
  const prof = [];
  let _t = Date.now();
  const mark = (name) => { const now = Date.now(); prof.push({ stage: name, ms: now - _t }); _t = now; };

  const { sev, seg } = await getModels(onProgress);
  mark('모델 로드');

  // ---- 세그멘테이션 (EffB0-UNet++ @512) ----
  let segUri = null, areaPct = null, segMs = null;
  let areaFrac = 0, bbox = null;   // 중증도 크롭·면적 스칼라용
  if (ENABLE_SEG && seg) {
    onProgress && onProgress('병변 영역 검출 중...');
    const S = SEG_SIZE;
    const imgS = await imageToRGBA(imageUri, S);
    mark('세그·이미지 준비');
    const segIn = toNCHW(imgS.data, S);
    mark('세그·전처리');
    // EffB0-UNet++ I/O: 입력 NCHW [1,3,S,S], 출력 NCHW [1,1,S,S] (1채널 로짓, sigmoid>0.5 ⟺ logit>0)
    const segOut = await seg.run([segIn.buffer]);
    mark('세그·추론');
    segMs = prof[prof.length - 1].ms;
    const logits = new Float32Array(segOut[0]);
    const HW = S * S;
    const mask = new Uint8Array(HW);
    let lesion = 0, minX = S, minY = S, maxX = 0, maxY = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const p = y * S + x;
        const on = logits[p] > 0 ? 1 : 0;
        mask[p] = on;
        if (on) { lesion++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
    }
    areaFrac = lesion / HW;                        // 0~1 (중증도 모델 area 입력)
    areaPct = Math.round(1000 * areaFrac) / 10;    // 표시용 %
    if (lesion > 10) bbox = { minX, minY, maxX, maxY };   // 병변 있으면 crop bbox
    const rgba = imgS.data, ov = new Uint8Array(rgba);
    for (let p = 0; p < HW; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      ov[i]     = (rgba[i]     * 0.5 + 46  * 0.5) | 0;
      ov[i + 1] = (rgba[i + 1] * 0.5 + 204 * 0.5) | 0;
      ov[i + 2] = (rgba[i + 2] * 0.5 + 113 * 0.5) | 0;
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const p = y * S + x;
        if (!mask[p]) continue;
        const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1 ||
          !mask[p - 1] || !mask[p + 1] || !mask[p - S] || !mask[p + S];
        if (edge) { const i = p * 4; ov[i] = 255; ov[i + 1] = 220; ov[i + 2] = 0; }
      }
    }
    mark('세그·마스크/면적');
    const enc = jpeg.encode({ data: ov, width: S, height: S }, 85);
    segUri = 'data:image/jpeg;base64,' + fromByteArray(enc.data);
    mark('세그·오버레이 생성');
  }

  // ---- 중증도 (PVTv2-B0 크롭+면적, 2입력 NCHW 512) ----
  onProgress && onProgress('중증도 평가 중...');
  // 세그 bbox로 병변만 크롭(15% 패딩) → 512. 병변 없으면 전체 이미지 폴백.
  let imgSev = null;
  if (bbox) {
    const S = SEG_SIZE;
    const pw = (bbox.maxX - bbox.minX) * 0.15, ph = (bbox.maxY - bbox.minY) * 0.15;
    const fx0 = Math.max(0, (bbox.minX - pw) / S), fy0 = Math.max(0, (bbox.minY - ph) / S);
    const fx1 = Math.min(1, (bbox.maxX + pw) / S), fy1 = Math.min(1, (bbox.maxY + ph) / S);
    const dim = await imageSize(imageUri);
    if (dim && dim.w && dim.h) {
      const ox = Math.round(fx0 * dim.w), oy = Math.round(fy0 * dim.h);
      const cw = Math.max(8, Math.round((fx1 - fx0) * dim.w)), ch = Math.max(8, Math.round((fy1 - fy0) * dim.h));
      try {
        const cr = await manipulateAsync(imageUri,
          [{ crop: { originX: ox, originY: oy, width: cw, height: ch } }, { resize: { width: SEV_SIZE, height: SEV_SIZE } }],
          { compress: 1, format: SaveFormat.JPEG, base64: true });
        imgSev = jpeg.decode(toByteArray(cr.base64), { useTArray: true, formatAsRGBA: true });
      } catch (e) { imgSev = null; }
    }
  }
  if (!imgSev) imgSev = await imageToRGBA(imageUri, SEV_SIZE);   // 폴백
  mark('중증도·크롭+이미지 준비');
  const sevIn = toNCHW(imgSev.data, SEV_SIZE);
  const areaIn = new Float32Array([areaFrac]);                   // 면적 스칼라 (0~1)
  mark('중증도·전처리');
  const sevOut = await sev.run([sevIn.buffer, areaIn.buffer]);   // 2입력: [이미지, 면적]
  mark('중증도·추론');
  const sevMs = prof[prof.length - 1].ms;
  const ord = sevOutOrder(sev);
  const severity = SEV_HEADS.map((h, i) => {
    const lvl = cornLevel(new Float32Array(sevOut[ord[i]]));
    const grade = h.classes[lvl];
    return { key: h.key, name: h.name, grade,
             grade_ko: GRADE_KO[grade] || grade, level: lvl, max_level: h.classes.length - 1 };
  });
  mark('중증도·후처리(CORN)');

  const totalMs = prof.reduce((a, b) => a + b.ms, 0);
  return {
    mode: 'full',
    stage1: null,
    gradcam: null,
    segmentation: segUri,
    lesion_area_pct: areaPct,
    severity,
    metrics: {
      seg_inference_ms: segMs, severity_inference_ms: sevMs,
      total_ms: totalMs, profile: prof, device: `On-Device (${_device})`,
    },
  };
}
