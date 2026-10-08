'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import { Play } from 'lucide-react';
import type { Transcript } from '@/types';
import { formatClock, speakerColor, speakerInitial, type SpeakerColor } from '@/lib/speakers';

interface TranscriptListProps {
  transcripts: Transcript[];
  speakers: string[];
  currentTime: number;
  isPlaying: boolean;
  canPlay: boolean;
  follow: boolean;
  onUserScroll: () => void;
  onSeek: (time: number, autoplay: boolean) => void;
  onRenameSpeaker: (transcript: Transcript) => void;
}

/** Index of the segment playing at `time`: last segment starting at or before it */
export function findActiveIndex(transcripts: Transcript[], time: number): number {
  let lo = 0;
  let hi = transcripts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((transcripts[mid].audio_start_time ?? 0) <= time + 0.05) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return -1;
  const end = transcripts[found].audio_end_time;
  // Between segments (silence): keep highlighting the previous one for up to 1.5s
  return end === undefined || time <= end + 1.5 ? found : -1;
}

interface RowProps {
  transcript: Transcript;
  color: SpeakerColor;
  active: boolean;
  canPlay: boolean;
  onSeek: (time: number, autoplay: boolean) => void;
  onRenameSpeaker: (transcript: Transcript) => void;
}

const TranscriptRow = memo(function TranscriptRow({ transcript, color, active, canPlay, onSeek, onRenameSpeaker }: RowProps) {
  const start = transcript.audio_start_time ?? 0;
  const label = transcript.speaker ?? '참석자';

  return (
    <div data-start={start} className="group flex gap-3 px-6 py-3">
      <div
        className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: color.bg }}
        aria-hidden
      >
        {speakerInitial(transcript.speaker)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onRenameSpeaker(transcript)}
            className="rounded text-sm font-semibold text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-note-green/40"
            title="참석자 이름 변경"
          >
            {label}
          </button>
          <button
            type="button"
            disabled={!canPlay}
            onClick={() => onSeek(start, true)}
            className="flex items-center gap-1 rounded text-xs tabular-nums text-gray-400 hover:text-note-green disabled:hover:text-gray-400"
            title={canPlay ? '이 시점부터 재생' : undefined}
          >
            {formatClock(start)}
            {canPlay && <Play className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />}
          </button>
        </div>
        <p
          onClick={() => canPlay && onSeek(start, true)}
          className={`-mx-1.5 whitespace-pre-wrap break-words rounded-md px-1.5 py-0.5 text-[15px] leading-relaxed text-gray-800 transition-colors ${
            canPlay ? 'cursor-pointer' : ''
          } ${active ? 'bg-note-highlight' : canPlay ? 'hover:bg-gray-50' : ''}`}
        >
          {transcript.text}
        </p>
      </div>
    </div>
  );
});

export function TranscriptList({
  transcripts,
  speakers,
  currentTime,
  isPlaying,
  canPlay,
  follow,
  onUserScroll,
  onSeek,
  onRenameSpeaker,
}: TranscriptListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeIndex = useMemo(
    () => (canPlay ? findActiveIndex(transcripts, currentTime) : -1),
    [transcripts, currentTime, canPlay],
  );

  // Keep the playing line in view while following playback
  useEffect(() => {
    if (!follow || !isPlaying || activeIndex < 0 || !containerRef.current) return;
    const row = containerRef.current.children[activeIndex] as HTMLElement | undefined;
    // The scroll container is the positioned parent, so offsetTop is relative to its content
    const scroller = containerRef.current.parentElement;
    if (!row || !scroller) return;
    const rowTop = row.offsetTop;
    const visibleTop = scroller.scrollTop;
    const visibleBottom = visibleTop + scroller.clientHeight;
    if (rowTop < visibleTop + 40 || rowTop + row.offsetHeight > visibleBottom - 80) {
      scroller.scrollTo({ top: Math.max(0, rowTop - scroller.clientHeight / 3), behavior: 'smooth' });
    }
  }, [activeIndex, follow, isPlaying]);

  return (
    <div ref={containerRef} onWheel={onUserScroll} onTouchMove={onUserScroll} className="py-2">
      {transcripts.map((t, i) => (
        <TranscriptRow
          key={t.id}
          transcript={t}
          color={speakerColor(t.speaker, speakers)}
          active={i === activeIndex}
          canPlay={canPlay}
          onSeek={onSeek}
          onRenameSpeaker={onRenameSpeaker}
        />
      ))}
    </div>
  );
}
