import type { Transcript } from '@/types';

/** Avatar colors for speakers, assigned by order of first appearance */
const SPEAKER_COLORS = [
  { bg: '#E8573F', soft: '#FDECE8' },
  { bg: '#3D8BFD', soft: '#E7F0FF' },
  { bg: '#8B5CF6', soft: '#F1EBFE' },
  { bg: '#10B981', soft: '#E3F8F0' },
  { bg: '#F59E0B', soft: '#FEF3DC' },
  { bg: '#EC4899', soft: '#FDE8F3' },
  { bg: '#0EA5E9', soft: '#E0F3FC' },
  { bg: '#84CC16', soft: '#EEF9DB' },
];

const UNKNOWN_COLOR = { bg: '#9CA3AF', soft: '#F3F4F6' };

export type SpeakerColor = typeof UNKNOWN_COLOR;

/** Distinct speaker names in order of first appearance */
export function orderedSpeakers(transcripts: Pick<Transcript, 'speaker'>[]): string[] {
  const seen: string[] = [];
  for (const t of transcripts) {
    if (t.speaker && !seen.includes(t.speaker)) seen.push(t.speaker);
  }
  return seen;
}

export function speakerColor(speaker: string | null | undefined, speakers: string[]): SpeakerColor {
  if (!speaker) return UNKNOWN_COLOR;
  const index = speakers.indexOf(speaker);
  return index < 0 ? UNKNOWN_COLOR : SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

/** Short avatar text: trailing number for default labels ("참석자 3" → "3"), else first character */
export function speakerInitial(speaker: string | null | undefined): string {
  if (!speaker) return '?';
  const numbered = speaker.match(/^참석자\s*(\d+)$/);
  if (numbered) return numbered[1];
  return Array.from(speaker.trim())[0]?.toUpperCase() ?? '?';
}

/** "mm:ss", or "h:mm:ss" once past an hour */
export function formatClock(seconds: number | undefined | null): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "1시간 2분 3초" style duration */
export function formatDurationKo(seconds: number | undefined | null): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h ? `${h}시간` : '', m ? `${m}분` : '', !h && s ? `${s}초` : ''].filter(Boolean).join(' ') || '0초';
}

/** "2026.10.07 (수) 오후 1:25" */
export function formatNoteDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${day}) ${time}`;
}
