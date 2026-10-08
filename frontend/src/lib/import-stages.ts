/** Korean labels for import/retranscription progress stages emitted by the backend */
const STAGE_LABELS: Record<string, string> = {
  copying: '파일 복사 중',
  decoding: '오디오 읽는 중',
  resampling: '오디오 변환 중',
  vad: '음성 구간 찾는 중',
  diarizing: '참석자 구분 중',
  transcribing: '음성 기록 생성 중',
  saving: '노트 저장 중',
  complete: '완료',
};

export function stageLabel(stage: string | null | undefined): string {
  return (stage && STAGE_LABELS[stage]) || '처리 중';
}
