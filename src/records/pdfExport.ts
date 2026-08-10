import { Asset } from 'expo-asset';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  DISPLAY_SCALE,
  itchBand,
  skinConditionInfo,
  sleepBand,
  symptomBand,
  SYMPTOMS,
} from '../folders/theme';
import { getMemo } from './memoStore';

/**
 * 기록을 PDF 보고서로 내보낸다.
 *
 * 진료실에서 보여주는 것이 목적이라 화면 UI를 그대로 옮기지 않았다 — 색 막대·배지 대신 숫자와
 * 단계 이름을 표로 적고, 기록 한 건이 한 덩어리로 붙어 있도록(page-break-inside: avoid) 짰다.
 * 무엇을 넣을지는 사용자가 고르므로(ExportField), 고르지 않은 항목은 표에서 아예 빠진다.
 *
 * 사진은 base64로 문서 안에 박아 넣는다. file:// 링크를 그대로 두면 PDF 변환기가 읽지 못해
 * 빈 칸으로 남는다. 원본 그대로 넣으면 한 장에 수 MB라 문서가 감당하지 못하므로 긴 변 900px로
 * 줄여서 담는다.
 */

/** 보고서에 넣을 수 있는 항목 */
export type ExportField = 'photo' | 'skin' | 'symptoms' | 'itch' | 'sleep' | 'memo';

export const EXPORT_FIELDS: { key: ExportField; label: string; caption: string }[] = [
  { key: 'photo', label: '이미지', caption: '그날 촬영한 사진' },
  { key: 'skin', label: '피부 종합 상태', caption: '0~100 표시값과 단계' },
  { key: 'symptoms', label: '4가지 증상', caption: '붉기 · 오돌토돌함 · 긁은 상처 · 두꺼워짐' },
  { key: 'itch', label: '가려움 안정도', caption: '가려움 문진(VAS)' },
  { key: 'sleep', label: '수면 점수', caption: '스마트워치 연동 값' },
  { key: 'memo', label: '메모', caption: '기록에 직접 남긴 글' },
];

/** 내보낼 기록 한 건 */
export interface ExportRecord {
  folderId: string;
  folderName: string;
  record: any;
}

const SYMPTOM_ORDER = ['redness', 'bumps', 'scratch', 'thickening'] as const;

const fmtDate = (dateKey: string) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${y}.${m}.${d}`;
};

/** HTML에 값을 넣기 전에 태그로 읽힐 수 있는 문자를 막는다 (메모는 사용자가 쓴 글이다) */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 사진을 문서에 박을 수 있는 data URI로 바꾼다.
 * 데모 기록의 사진은 require()된 에셋(숫자)이고, 실제 촬영은 {uri} 객체다 — 둘 다 받는다.
 * 실패하면 null을 돌려주고, 그 기록은 사진 없이 나간다 (한 장 때문에 내보내기를 막지 않는다).
 */
async function photoDataUri(photo: any): Promise<string | null> {
  try {
    let uri: string | undefined;
    if (typeof photo === 'number') {
      const asset = Asset.fromModule(photo);
      await asset.downloadAsync();
      uri = asset.localUri ?? asset.uri;
    } else if (photo && typeof photo === 'object') {
      uri = photo.uri;
    }
    if (!uri) return null;
    if (uri.startsWith('data:')) return uri;

    // 긴 변 900px · 품질 0.7로 줄여서 담는다 — 원본 그대로면 문서가 수십 MB가 된다
    const shrunk = await manipulateAsync(uri, [{ resize: { width: 900 } }], {
      compress: 0.7,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (shrunk.base64) return `data:image/jpeg;base64,${shrunk.base64}`;
    const raw = await readAsStringAsync(shrunk.uri, { encoding: 'base64' });
    return `data:image/jpeg;base64,${raw}`;
  } catch (e) {
    console.warn('[pdf] 사진을 담지 못했어요:', e);
    return null;
  }
}

/** 지표 한 줄 — 값과 단계 이름을 함께 적는다 (숫자만 있으면 좋은 건지 나쁜 건지 알 수 없다) */
function metricRow(label: string, value: string, band?: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td><td class="band">${
    band ? escapeHtml(band) : ''
  }</td></tr>`;
}

function recordSection(
  entry: ExportRecord,
  fields: Set<ExportField>,
  photo: string | null,
  memo: string,
  healthConnected: boolean,
): string {
  const r = entry.record;
  const rows: string[] = [];

  if (fields.has('skin')) {
    const v = DISPLAY_SCALE.iga(r.iga);
    rows.push(metricRow('피부 종합 상태', `${Math.round(v)}`, skinConditionInfo(v).ko));
  }
  if (fields.has('symptoms')) {
    // 세부 증상은 점수를 적지 않고 이름만 적는다(뚜렷함/두드러짐/미미함/없음)
    SYMPTOM_ORDER.forEach((key) => {
      const v = DISPLAY_SCALE.symptom(r[key]);
      rows.push(metricRow(SYMPTOMS[key].label, symptomBand(v).ko));
    });
  }
  if (fields.has('itch')) {
    const v = DISPLAY_SCALE.itch(r.itchVas);
    rows.push(metricRow('가려움 안정도', `${v}`, itchBand(v).ko));
  }
  if (fields.has('sleep')) {
    rows.push(
      healthConnected
        ? metricRow('수면 점수', `${r.sleepScore}`, sleepBand(r.sleepScore).ko)
        : metricRow('수면 점수', '미기재'),
    );
  }

  const photoBlock =
    fields.has('photo') && photo ? `<div class="photo"><img src="${photo}" /></div>` : '';
  const tableBlock = rows.length ? `<table>${rows.join('')}</table>` : '';
  const memoBlock =
    fields.has('memo') && memo
      ? `<div class="memo"><div class="memo-label">메모</div><div>${escapeHtml(memo).replace(
          /\n/g,
          '<br/>',
        )}</div></div>`
      : '';

  return `
    <section class="record">
      <div class="record-head">
        <div class="site">${escapeHtml(entry.folderName)}</div>
        <div class="date">${fmtDate(r.date)}</div>
      </div>
      ${photoBlock}
      ${tableBlock}
      ${memoBlock}
    </section>`;
}

/** 보고서 HTML 전체 */
export function buildReportHtml(
  sections: string[],
  meta: { total: number; createdAt: Date },
): string {
  const d = meta.createdAt;
  const created = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 30px; font-family: -apple-system, "Noto Sans KR", sans-serif; color: #1C1C1E; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { font-size: 11px; color: #8E8E93; margin-bottom: 18px; }
  .record { border: 1px solid #ECECEF; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; page-break-inside: avoid; }
  .record-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #ECECEF; padding-bottom: 8px; margin-bottom: 10px; }
  .site { font-size: 14px; font-weight: 700; }
  .date { font-size: 11px; color: #8E8E93; }
  .photo { text-align: center; margin-bottom: 10px; }
  .photo img { max-width: 260px; max-height: 260px; border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 5px 0; border-bottom: 1px solid #F4F6F9; }
  th { width: 42%; font-weight: 600; color: #4a4a4f; }
  td { width: 29%; }
  td.band { color: #8E8E93; text-align: right; }
  .memo { margin-top: 10px; background: #F4F6F9; border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.6; }
  .memo-label { font-size: 10px; font-weight: 700; color: #8E8E93; margin-bottom: 3px; }
  .footer { margin-top: 18px; font-size: 10px; color: #8E8E93; text-align: center; }
</style></head>
<body>
  <h1>피부 기록 보고서</h1>
  <div class="sub">${created} 생성 · 총 ${meta.total}건</div>
  ${sections.join('')}
  <div class="footer">이 앱은 치료와 진단을 하지 않습니다. 의심이 들 경우 전문의에게 상담하세요.</div>
</body></html>`;
}

/**
 * 고른 기록·항목으로 PDF를 만들어 공유 시트를 띄운다.
 * 공유를 쓸 수 없는 기기에서는 만들어진 파일 경로를 돌려주기만 한다.
 */
export async function exportRecordsPdf(
  entries: ExportRecord[],
  fields: ExportField[],
  options: { healthConnected: boolean },
): Promise<{ uri: string; shared: boolean }> {
  const set = new Set(fields);
  // 날짜순으로 정렬해 둔다 — 보고서는 시간 순서대로 읽히는 것이 자연스럽다
  const ordered = [...entries].sort((a, b) =>
    a.record.date === b.record.date ? a.folderName.localeCompare(b.folderName) : a.record.date < b.record.date ? -1 : 1,
  );

  const sections: string[] = [];
  for (const entry of ordered) {
    const photo = set.has('photo') ? await photoDataUri(entry.record.photo) : null;
    const memo = set.has('memo')
      ? getMemo({ date: entry.record.date, folderId: entry.folderId, recordId: String(entry.record.id) })
      : '';
    sections.push(recordSection(entry, set, photo, memo, options.healthConnected));
  }

  const html = buildReportHtml(sections, { total: ordered.length, createdAt: new Date() });
  const { uri } = await Print.printToFileAsync({ html });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: '피부 기록 보고서' });
    return { uri, shared: true };
  }
  return { uri, shared: false };
}
