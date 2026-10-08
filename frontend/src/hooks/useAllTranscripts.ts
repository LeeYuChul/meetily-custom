import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { MeetingMetadata, PaginatedTranscriptsResponse, Transcript } from '@/types';

const PAGE_SIZE = 500;

/**
 * Loads a meeting's metadata and its complete transcript.
 * The note view needs every segment at once for playback sync, speaker
 * renaming and export, so pages are fetched until the end.
 */
export function useAllTranscripts(meetingId: string | null) {
  const [metadata, setMetadata] = useState<MeetingMetadata | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (!meetingId) return;
      const request = ++requestRef.current;
      if (showSpinner) setIsLoading(true);
      setError(null);
      try {
        const meta = await invoke<MeetingMetadata | null>('api_get_meeting_metadata', { meetingId });
        if (!meta) throw new Error('Meeting not found');
        const all: Transcript[] = [];
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const page = await invoke<PaginatedTranscriptsResponse>('api_get_meeting_transcripts', {
            meetingId,
            limit: PAGE_SIZE,
            offset,
          });
          all.push(...page.transcripts);
          if (!page.has_more || page.transcripts.length === 0) break;
        }
        if (request !== requestRef.current) return;
        setMetadata(meta);
        setTranscripts(all);
      } catch (e) {
        if (request !== requestRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (request === requestRef.current) setIsLoading(false);
      }
    },
    [meetingId],
  );

  useEffect(() => {
    setMetadata(null);
    setTranscripts([]);
    void load(true);
  }, [load]);

  /** Reload without blanking the view (after rename/diarization/retranscription) */
  const refetch = useCallback(() => load(false), [load]);

  return { metadata, transcripts, setTranscripts, isLoading, error, refetch };
}
