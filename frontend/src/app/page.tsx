'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { FileAudio, NotebookPen, Sparkles, Upload, Users } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { formatNoteDate } from '@/lib/speakers';
import Analytics from '@/lib/analytics';

const FEATURES = [
  { icon: FileAudio, title: '음성 기록', text: '회의 파일을 올리면 말한 내용을 문단별로 기록합니다' },
  { icon: Users, title: '참석자 구분', text: '목소리로 참석자를 나누고 이름을 붙일 수 있습니다' },
  { icon: Sparkles, title: 'AI 요약', text: '기록을 바탕으로 회의 내용을 요약합니다' },
];

export default function Home() {
  const router = useRouter();
  const { meetings, setCurrentMeeting, refetchMeetings } = useSidebar();
  const { openImportDialog } = useImportDialog();

  useEffect(() => {
    Analytics.trackPageView('home');
    void refetchMeetings();
  }, [refetchMeetings]);

  const openNote = (id: string, title: string) => {
    setCurrentMeeting({ id, title });
    router.push(`/meeting-details?id=${id}`);
  };

  return (
    <div className="h-screen overflow-y-auto bg-note-canvas">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mx-auto max-w-5xl px-10 py-10"
      >
        <h1 className="text-2xl font-bold text-gray-900">홈</h1>
        <p className="mt-1 text-sm text-gray-500">회의 녹음 파일을 올리면 음성 기록, 참석자 구분, AI 요약을 만들어 드립니다.</p>

        <button
          type="button"
          onClick={() => openImportDialog()}
          className="group mt-6 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-white px-6 py-10 transition-colors hover:border-note-green hover:bg-note-mint/40"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-note-green text-white shadow-sm transition-transform group-hover:scale-105">
            <Upload className="h-6 w-6" />
          </span>
          <span className="mt-3 text-base font-semibold text-gray-900">파일 업로드</span>
          <span className="mt-1 text-sm text-gray-500">클릭하거나 파일을 이 창으로 끌어다 놓으세요</span>
          <span className="mt-2 text-xs text-gray-400">MP3 · M4A · WAV · MP4 · FLAC · OGG · WEBM · MKV · WMA</span>
        </button>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Icon className="h-4 w-4 text-note-green" />
                {title}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{text}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-gray-900">최근 노트</h2>
          <span className="text-sm text-gray-400">{meetings.length}개</span>
        </div>

        {meetings.length === 0 ? (
          <div className="mt-3 rounded-2xl bg-white px-6 py-12 text-center text-sm text-gray-400">
            아직 노트가 없습니다. 첫 회의 파일을 올려 보세요.
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3">
            {meetings.slice(0, 30).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => openNote(m.id, m.title)}
                className="flex items-start gap-3 rounded-xl bg-white px-4 py-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-note-mint text-note-green">
                  <NotebookPen className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-gray-900">{m.title}</span>
                  <span className="mt-0.5 block text-xs text-gray-400">{formatNoteDate(m.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
