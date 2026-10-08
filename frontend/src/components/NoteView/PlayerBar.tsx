'use client';

import { memo, useCallback, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw, LocateFixed } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Transcript } from '@/types';
import type { MeetingAudio } from '@/hooks/useMeetingAudio';
import { PLAYBACK_RATES } from '@/hooks/useMeetingAudio';
import { formatClock, speakerColor } from '@/lib/speakers';

interface PlayerBarProps {
  audio: MeetingAudio;
  transcripts: Transcript[];
  speakers: string[];
  follow: boolean;
  onFollow: () => void;
}

/** Speaker-colored segments under the progress track (static, so memoized) */
const SpeakerTimeline = memo(function SpeakerTimeline({
  transcripts,
  speakers,
  duration,
}: {
  transcripts: Transcript[];
  speakers: string[];
  duration: number;
}) {
  if (duration <= 0) return null;
  return (
    <>
      {transcripts.map((t) => {
        const start = t.audio_start_time ?? 0;
        const end = t.audio_end_time ?? start;
        return (
          <span
            key={t.id}
            className="absolute top-0 h-full rounded-[1px] opacity-60"
            style={{
              left: `${(start / duration) * 100}%`,
              width: `max(2px, ${((end - start) / duration) * 100}%)`,
              backgroundColor: speakerColor(t.speaker, speakers).bg,
            }}
          />
        );
      })}
    </>
  );
});

export function PlayerBar({ audio, transcripts, speakers, follow, onFollow }: PlayerBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<{ x: number; time: number } | null>(null);
  const dragging = useRef(false);
  const disabled = audio.status !== 'ready';
  const duration = audio.duration || transcripts[transcripts.length - 1]?.audio_end_time || 0;
  const progress = duration > 0 ? Math.min(1, audio.currentTime / duration) : 0;

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return null;
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return { x: clientX - rect.left, time: fraction * duration };
    },
    [duration],
  );

  const statusText =
    audio.status === 'loading' ? '오디오 불러오는 중...' :
    audio.status === 'missing' ? '이 노트에는 오디오 파일이 없습니다' :
    audio.status === 'error' ? '오디오를 재생할 수 없습니다' : null;

  return (
    <div className="flex-shrink-0 border-t border-note-line bg-white px-6 pb-3 pt-2">
      {/* Progress track */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="재생 위치"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(audio.currentTime)}
        tabIndex={disabled ? -1 : 0}
        className={`group relative h-5 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const at = timeAt(e.clientX);
          if (at) audio.seek(at.time);
        }}
        onPointerMove={(e) => {
          const at = timeAt(e.clientX);
          setHoverTime(at);
          if (dragging.current && at) audio.seek(at.time);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => setHoverTime(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') audio.skip(-5);
          if (e.key === 'ArrowRight') audio.skip(5);
        }}
      >
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-gray-100">
          <SpeakerTimeline transcripts={transcripts} speakers={speakers} duration={duration} />
        </div>
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-800/70"
          style={{ width: `${progress * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-gray-900 shadow transition-transform group-hover:scale-110"
          style={{ left: `${progress * 100}%` }}
        />
        {hoverTime && !disabled && (
          <div
            className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-gray-900 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
            style={{ left: hoverTime.x }}
          >
            {formatClock(hoverTime.time)}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-1 grid grid-cols-3 items-center">
        <div className="text-xs tabular-nums text-gray-500">
          {statusText ?? (
            <>
              <span className="text-gray-900">{formatClock(audio.currentTime)}</span> / {formatClock(duration)}
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disabled}
              className="w-12 rounded-md py-1 text-sm font-medium tabular-nums text-gray-700 hover:bg-gray-100 disabled:opacity-40"
              title="재생 속도"
            >
              {audio.rate}x
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top">
              <DropdownMenuRadioGroup value={String(audio.rate)} onValueChange={(v) => audio.setRate(Number(v))}>
                {PLAYBACK_RATES.map((r) => (
                  <DropdownMenuRadioItem key={r} value={String(r)}>
                    {r}x
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            disabled={disabled}
            onClick={() => audio.skip(-5)}
            className="relative rounded-full p-2 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            title="5초 뒤로"
            aria-label="5초 뒤로"
          >
            <RotateCcw className="h-5 w-5" />
            <span className="absolute inset-0 flex items-center justify-center pt-0.5 text-[8px] font-bold">5</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={audio.toggle}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white shadow hover:bg-gray-700 disabled:opacity-40"
            title={audio.isPlaying ? '일시정지 (Space)' : '재생 (Space)'}
            aria-label={audio.isPlaying ? '일시정지' : '재생'}
          >
            {audio.isPlaying ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => audio.skip(5)}
            className="relative rounded-full p-2 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            title="5초 앞으로"
            aria-label="5초 앞으로"
          >
            <RotateCw className="h-5 w-5" />
            <span className="absolute inset-0 flex items-center justify-center pt-0.5 text-[8px] font-bold">5</span>
          </button>
          <span className="w-12" />
        </div>

        <div className="flex justify-end">
          {!follow && audio.isPlaying && (
            <button
              type="button"
              onClick={onFollow}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              <LocateFixed className="h-3.5 w-3.5" />
              재생 위치로
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
