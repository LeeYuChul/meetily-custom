import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Plays a meeting's audio file through an HTMLAudioElement served by the
 * Tauri asset protocol (streamed with range requests, no full-file IPC copy).
 */
export function useMeetingAudio(meetingId: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>();
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setSrc(null);
    if (!meetingId) return;
    invoke<string | null>('get_meeting_audio_path', { meetingId })
      .then((path) => {
        if (cancelled) return;
        if (!path) {
          setStatus('missing');
          return;
        }
        setSrc(convertFileSrc(path));
      })
      .catch((e) => {
        console.error('Failed to resolve meeting audio:', e);
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    if (!src) return;
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = src;
    audioRef.current = audio;

    // ~10Hz is enough for line highlighting and keeps re-renders cheap
    let lastReported = -1;
    const tick = () => {
      if (Math.abs(audio.currentTime - lastReported) >= 0.1) {
        lastReported = audio.currentTime;
        setCurrentTime(audio.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setIsPlaying(true);
      cancelAnimationFrame(rafRef.current!);
      rafRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current!);
      setCurrentTime(audio.currentTime);
    };
    const onMeta = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setStatus('ready');
    };
    const onError = () => {
      console.error('Audio element error:', audio.error);
      setStatus('error');
    };
    const onSeeked = () => setCurrentTime(audio.currentTime);
    // rAF stops when the window is hidden/occluded; timeupdate (~4Hz) keeps the clock moving
    const onTimeUpdate = () => {
      if (Math.abs(audio.currentTime - lastReported) >= 0.1) {
        lastReported = audio.currentTime;
        setCurrentTime(audio.currentTime);
      }
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('seeked', onSeeked);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', onError);
    return () => {
      cancelAnimationFrame(rafRef.current!);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, [src]);

  const play = useCallback(async () => {
    try {
      await audioRef.current?.play();
    } catch (e) {
      console.error('Playback failed:', e);
    }
  }, []);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void play();
    else audio.pause();
  }, [play]);

  /** Jump to `time` (seconds); starts playback when `autoplay` is set */
  const seek = useCallback(
    (time: number, autoplay = false) => {
      const audio = audioRef.current;
      if (!audio) return;
      const max = Number.isFinite(audio.duration) ? audio.duration : time;
      audio.currentTime = Math.min(Math.max(0, time), max);
      setCurrentTime(audio.currentTime);
      if (autoplay && audio.paused) void play();
    },
    [play],
  );

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (audio) seek(audio.currentTime + delta);
  }, [seek]);

  const setRate = useCallback((value: number) => {
    if (audioRef.current) audioRef.current.playbackRate = value;
    setRateState(value);
  }, []);

  return { status, isPlaying, currentTime, duration, rate, play, pause, toggle, seek, skip, setRate };
}

export type MeetingAudio = ReturnType<typeof useMeetingAudio>;
