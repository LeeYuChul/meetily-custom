import type { Transcript } from '@/types';
import { formatClock, formatDurationKo, formatNoteDate } from '@/lib/speakers';

export type ExportFormat = 'txt' | 'md' | 'srt' | 'docx';

export const EXPORT_FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: 'txt', label: '텍스트 (.txt)', description: '화자와 시간이 포함된 일반 텍스트' },
  { value: 'docx', label: 'Word 문서 (.docx)', description: '문서 편집기에서 바로 열 수 있는 형식' },
  { value: 'md', label: 'Markdown (.md)', description: '노션·위키에 붙여넣기 좋은 형식' },
  { value: 'srt', label: '자막 (.srt)', description: '영상 자막 파일 형식' },
];

export interface ExportSource {
  title: string;
  createdAt?: string;
  durationSeconds?: number;
  transcripts: Transcript[];
}

function sanitizeFileName(name: string): string {
  return (name.trim() || 'transcript').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}

function metaLine(source: ExportSource): string {
  return [
    formatNoteDate(source.createdAt),
    source.durationSeconds ? formatDurationKo(source.durationSeconds) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(
    Math.floor((ms % 60000) / 1000),
  )},${pad(ms % 1000, 3)}`;
}

function heading(t: Transcript): string {
  const time = formatClock(t.audio_start_time);
  return t.speaker ? `${t.speaker} ${time}` : `[${time}]`;
}

function buildText(source: ExportSource): string {
  const lines = [source.title, metaLine(source), ''];
  for (const t of source.transcripts) {
    lines.push(heading(t), t.text.trim(), '');
  }
  return lines.join('\r\n');
}

function buildMarkdown(source: ExportSource): string {
  const lines = [`# ${source.title}`, '', `_${metaLine(source)}_`, ''];
  for (const t of source.transcripts) {
    const time = `\`${formatClock(t.audio_start_time)}\``;
    lines.push(t.speaker ? `**${t.speaker}** ${time}` : time, '', t.text.trim(), '');
  }
  return lines.join('\n');
}

function buildSrt(source: ExportSource): string {
  return source.transcripts
    .map((t, i) => {
      const start = t.audio_start_time ?? 0;
      const end = t.audio_end_time ?? start + (t.duration ?? 2);
      const text = t.speaker ? `[${t.speaker}] ${t.text.trim()}` : t.text.trim();
      return `${i + 1}\r\n${srtTime(start)} --> ${srtTime(end)}\r\n${text}\r\n`;
    })
    .join('\r\n');
}

async function buildDocx(source: ExportSource): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(source.title)] }),
    new Paragraph({ children: [new TextRun({ text: metaLine(source), color: '6B7280' })] }),
    new Paragraph({ children: [] }),
  ];
  for (const t of source.transcripts) {
    children.push(
      new Paragraph({
        spacing: { before: 200 },
        children: [
          ...(t.speaker ? [new TextRun({ text: `${t.speaker}  `, bold: true })] : []),
          new TextRun({ text: formatClock(t.audio_start_time), color: '9CA3AF' }),
        ],
      }),
      new Paragraph({ children: [new TextRun(t.text.trim())] }),
    );
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Malgun Gothic', size: 22 } } } },
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildExport(
  format: ExportFormat,
  source: ExportSource,
): Promise<{ fileName: string; data: Uint8Array }> {
  const base = sanitizeFileName(source.title);
  const encoder = new TextEncoder();
  switch (format) {
    case 'txt':
      // BOM so Windows Notepad/Excel detect UTF-8 Korean text
      return { fileName: `${base}.txt`, data: encoder.encode('﻿' + buildText(source)) };
    case 'md':
      return { fileName: `${base}.md`, data: encoder.encode(buildMarkdown(source)) };
    case 'srt':
      return { fileName: `${base}.srt`, data: encoder.encode('﻿' + buildSrt(source)) };
    case 'docx':
      return { fileName: `${base}.docx`, data: await buildDocx(source) };
  }
}
