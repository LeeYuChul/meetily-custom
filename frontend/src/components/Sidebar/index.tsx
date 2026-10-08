'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, File, Settings, ChevronsLeft, ChevronsRight, Calendar, StickyNote, Home, Trash2, Mic, Square, Plus, Search, Pencil, NotebookPen, SearchIcon, X, Upload, FolderInput, Check, FolderMinus } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';
import { NoteTree, type StartNoteDrag } from './NoteTree';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SettingTabs } from '../SettingTabs';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@/components/ui/visually-hidden"

import { MessageToast } from '../MessageToast';
import Logo from '../Logo';
import Info from '../Info';
import { ComplianceNotification } from '../ComplianceNotification';
import { Input } from '../ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group';

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    toggleCollapse,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
    serverAddress,
    folders,
    moveNoteToFolder,
  } = useSidebar();

  // Get recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['meetings']));
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: '',
    whisperModel: '',
    apiKey: null,
    ollamaEndpoint: null
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
  });
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState<boolean | null>(null);

  // State for edit modal
  const [editModalState, setEditModalState] = useState<{ isOpen: boolean; meetingId: string | null; currentTitle: string }>({
    isOpen: false,
    meetingId: null,
    currentTitle: ''
  });
  const [editingTitle, setEditingTitle] = useState<string>('');


  // useEffect(() => {
  //   if (settingsSaveSuccess !== null) {
  //     const timer = setTimeout(() => {
  //       setSettingsSaveSuccess(null);
  //     }, 3000);
  //   }
  // }, [settingsSaveSuccess]);


  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; itemId: string | null }>({ isOpen: false, itemId: null });

  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchModelConfig = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching model config');
        return;
      }

      try {
        const data = await invoke('api_get_model_config') as any;
        if (data && data.provider !== null) {
          // Fetch API key if not included and provider requires it
          if (data.provider !== 'ollama' && !data.apiKey) {
            try {
              const apiKeyData = await invoke('api_get_api_key', {
                provider: data.provider
              }) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }
          setModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      }
    };

    fetchModelConfig();
  }, [serverAddress]);


  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchTranscriptSettings = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching transcript settings');
        return;
      }

      try {
        const data = await invoke('api_get_transcript_config') as any;
        if (data && data.provider !== null) {
          setTranscriptModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch transcript settings:', error);
      }
    };
    fetchTranscriptSettings();
  }, [serverAddress]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.log('Sidebar received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);



  // Handle model config save
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);
      console.log('Model config saved successfully');
      setSettingsSaveSuccess(true);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      // Track settings change
      await Analytics.trackSettingsChanged('model_config', `${config.provider}_${config.model}`);
    } catch (error) {
      console.error('Error saving model config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  const handleSaveTranscriptConfig = async (updatedConfig?: TranscriptModelProps) => {
    try {
      const configToSave = updatedConfig || transcriptModelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        apiKey: configToSave.apiKey ?? null
      };
      console.log('Saving transcript config with payload:', payload);

      await invoke('api_save_transcript_config', {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey,
      });


      setSettingsSaveSuccess(true);

      // Track settings change
      const transcriptConfigToSave = updatedConfig || transcriptModelConfig;
      await Analytics.trackSettingsChanged('transcript_config', `${transcriptConfigToSave.provider}_${transcriptConfigToSave.model}`);
    } catch (error) {
      console.error('Failed to save transcript config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  // Handle search input changes
  const handleSearchChange = useCallback(async (value: string) => {
    setSearchQuery(value);

    // If search query is empty, just return to normal view
    if (!value.trim()) return;

    // Search through transcripts
    await searchTranscripts(value);

    // Make sure the meetings folder is expanded when searching
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders, searchTranscripts]);

  // Combine search results with sidebar items
  const filteredSidebarItems = useMemo(() => {
    if (!searchQuery.trim()) return sidebarItems;

    // If we have search results, highlight matching meetings
    if (searchResults.length > 0) {
      // Get the IDs of meetings that matched in transcripts
      const matchedMeetingIds = new Set(searchResults.map(result => result.id));

      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search results or title match
            const filteredChildren = folder.children.filter(item => {
              // Include if the meeting ID is in our search results
              if (matchedMeetingIds.has(item.id)) return true;

              // Or if the title matches the search query
              return item.title.toLowerCase().includes(searchQuery.toLowerCase());
            });

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return (matchedMeetingIds.has(folder.id) ||
            folder.title.toLowerCase().includes(searchQuery.toLowerCase()))
            ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    } else {
      // Fall back to title-only filtering if no transcript results
      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search query
            const filteredChildren = folder.children.filter(item =>
              item.title.toLowerCase().includes(searchQuery.toLowerCase())
            );

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return folder.title.toLowerCase().includes(searchQuery.toLowerCase()) ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    }
  }, [sidebarItems, searchQuery, searchResults, expandedFolders]);


  const handleDelete = async (itemId: string) => {
    console.log('Deleting item:', itemId);
    const payload = {
      meetingId: itemId
    };

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('api_delete_meeting', {
        meetingId: itemId,
      });
      console.log('Meeting deleted successfully');
      const updatedMeetings = meetings.filter((m: CurrentMeeting) => m.id !== itemId);
      setMeetings(updatedMeetings);

      // Track meeting deletion
      Analytics.trackMeetingDeleted(itemId);

      // Show success toast
      toast.success("노트를 삭제했습니다");

      // If deleting the active meeting, navigate to home
      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      toast.error("노트를 삭제하지 못했습니다", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteModalState.itemId) {
      handleDelete(deleteModalState.itemId);
    }
    setDeleteModalState({ isOpen: false, itemId: null });
  };

  // Handle modal editing of meeting names
  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({
      isOpen: true,
      meetingId: meetingId,
      currentTitle: currentTitle
    });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) return;

    // Prevent empty titles
    if (!newTitle) {
      toast.error("노트 이름을 입력하세요");
      return;
    }

    try {
      await invoke('api_save_meeting_title', {
        meetingId: meetingId,
        title: newTitle,
      });

      // Update local state
      const updatedMeetings = meetings.map((m: CurrentMeeting) =>
        m.id === meetingId ? { ...m, title: newTitle } : m
      );
      setMeetings(updatedMeetings);

      // Update current meeting if it's the one being edited
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }

      // Track the edit
      Analytics.trackButtonClick('edit_meeting_title', 'sidebar');

      toast.success("노트 이름을 변경했습니다");

      // Close modal and reset state
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error("노트 이름을 변경하지 못했습니다", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  };

  const toggleFolder = (folderId: string) => {
    // Normal toggle behavior for all folders
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  // Expose setShowModelSettings to window for Rust tray to call
  useEffect(() => {
    (window as any).openSettings = () => {
      setShowModelSettings(true);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).openSettings;
    };
  }, []);

  // Find matching transcript snippet for a meeting item
  const findMatchingSnippet = (itemId: string) => {
    if (!searchQuery.trim() || !searchResults.length) return null;
    return searchResults.find(result => result.id === itemId);
  };

  const isHomePage = pathname === '/';
  const isSettingsPage = pathname === '/settings';
  const notesFolder = filteredSidebarItems.find(item => item.id === 'meetings');
  const noteItems = notesFolder?.children ?? [];
  const notesExpanded = expandedFolders.has('meetings');
  const meetingById = useMemo(
    () => new Map(meetings.map((m: CurrentMeeting) => [m.id, m])),
    [meetings],
  );

  const navClass = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
      active ? 'bg-note-mint font-semibold text-gray-900' : 'text-gray-700 hover:bg-gray-100'
    }`;

  const openNote = (item: SidebarItem) => {
    setCurrentMeeting({ id: item.id, title: item.title });
    router.push(`/meeting-details?id=${item.id}`);
  };

  const renderNoteItem = (item: { id: string; title: string }, nested: boolean, startDrag: StartNoteDrag) => {
    const isActive = currentMeeting?.id === item.id && pathname?.includes('/meeting-details');
    const matchingResult = findMatchingSnippet(item.id);
    const meeting = meetingById.get(item.id);
    const createdAt = meeting?.created_at;
    const folderId = meeting?.note_folder_id ?? null;
    return (
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        onPointerDown={(e) => {
          // Ignore presses on the hover action buttons
          if (!(e.target as HTMLElement).closest('button')) startDrag(e, item);
        }}
        onClick={() => openNote(item as SidebarItem)}
        onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && openNote(item as SidebarItem)}
        className={`group relative cursor-pointer select-none rounded-lg py-1.5 pr-2 text-sm transition-colors ${nested ? 'pl-12' : 'pl-9'} ${
          isActive ? 'bg-note-mint text-gray-900' : matchingResult ? 'bg-yellow-50' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        <div className="flex items-center gap-1">
          <span className={`flex-1 truncate ${isActive ? 'font-semibold' : ''}`}>{item.title}</span>
          <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700"
                aria-label="폴더로 이동"
                title="폴더로 이동"
              >
                <FolderInput className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()} className="w-48">
                <DropdownMenuLabel className="text-xs font-normal text-gray-500">폴더로 이동</DropdownMenuLabel>
                {folders.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-gray-400">'전체 노트' 옆 + 버튼으로 폴더를 만드세요</p>
                )}
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    disabled={f.id === folderId}
                    onSelect={() => void moveNoteToFolder(item.id, f.id)}
                  >
                    <span className="flex-1 truncate">{f.name}</span>
                    {f.id === folderId && <Check className="h-3.5 w-3.5 text-note-green" />}
                  </DropdownMenuItem>
                ))}
                {folderId && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void moveNoteToFolder(item.id, null)}>
                      <FolderMinus className="mr-2 h-3.5 w-3.5" />
                      폴더에서 빼기
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleEditStart(item.id, item.title);
              }}
              className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700"
              aria-label="노트 이름 변경"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteModalState({ isOpen: true, itemId: item.id });
              }}
              className="rounded p-1 text-gray-400 hover:bg-white hover:text-red-600"
              aria-label="노트 삭제"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {createdAt && !matchingResult && (
          <div className="text-[11px] text-gray-400">{new Date(createdAt).toLocaleDateString('ko-KR')}</div>
        )}
        {matchingResult && (
          <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{matchingResult.matchContext}</div>
        )}
      </div>
    );
  };

  const renderCollapsed = () => (
    <TooltipProvider>
      <div className="flex flex-col items-center gap-2 pt-4">
        <Logo isCollapsed />
        {[
          { label: '파일 업로드', icon: Upload, onClick: () => openImportDialog(), active: false, accent: true },
          { label: '홈', icon: Home, onClick: () => router.push('/'), active: isHomePage, accent: false },
          { label: '전체 노트', icon: NotebookPen, onClick: () => toggleCollapse(), active: !!pathname?.includes('/meeting-details'), accent: false },
          { label: '설정', icon: Settings, onClick: () => router.push('/settings'), active: isSettingsPage, accent: false },
        ].map(({ label, icon: Icon, onClick, active, accent }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <button
                onClick={onClick}
                aria-label={label}
                className={`rounded-lg p-2.5 transition-colors ${
                  accent ? 'bg-note-green text-white hover:bg-note-green-dark' : active ? 'bg-note-mint text-gray-900' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{label}</p>
            </TooltipContent>
          </Tooltip>
        ))}
        <Info isCollapsed />
      </div>
    </TooltipProvider>
  );

  return (
    <div className="fixed top-0 left-0 h-screen z-40">
      <div
        className={`flex h-screen flex-col border-r border-note-line bg-white transition-all duration-300 ${
          isCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {isCollapsed ? (
          <>
            {renderCollapsed()}
            <button
              onClick={toggleCollapse}
              className="mx-auto mb-4 mt-auto rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="사이드바 펼치기"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            {/* Brand */}
            <div className="flex flex-shrink-0 items-center justify-between px-4 pb-2 pt-5">
              <button
                onClick={() => router.push('/')}
                className="flex items-center gap-2 text-[17px] font-extrabold tracking-tight text-gray-900"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-note-green text-white">
                  <NotebookPen className="h-4 w-4" />
                </span>
                Meetily Note
              </button>
              <button
                onClick={toggleCollapse}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="사이드바 접기"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </div>

            {/* Primary action */}
            <div className="flex-shrink-0 px-3 pt-2">
              <button
                onClick={() => openImportDialog()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-note-green py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-note-green-dark"
              >
                <Upload className="h-4 w-4" />
                파일 업로드
              </button>
            </div>

            {/* Search */}
            <div className="flex-shrink-0 px-3 pt-3">
              <InputGroup className="h-9 rounded-lg bg-note-canvas">
                <InputGroupInput
                  placeholder="노트 내용 검색"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                {searchQuery && (
                  <InputGroupAddon align={'inline-end'}>
                    <InputGroupButton onClick={() => handleSearchChange('')}>
                      <X />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </div>

            {/* Navigation */}
            <nav className="flex min-h-0 flex-1 flex-col px-3 pt-3">
              <button onClick={() => router.push('/')} className={navClass(isHomePage)}>
                <Home className="h-4 w-4" />홈
              </button>
              <NoteTree
                items={noteItems}
                expanded={notesExpanded}
                onToggleExpanded={() => toggleFolder('meetings')}
                searchQuery={searchQuery}
                isSearching={isSearching}
                renderNote={renderNoteItem}
              />
            </nav>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-note-line px-3 py-2">
              <button onClick={() => router.push('/settings')} className={navClass(isSettingsPage)}>
                <Settings className="h-4 w-4" />설정
              </button>
              <div className="flex items-center justify-between px-3 pt-1">
                <Info isCollapsed={false} />
                <span className="text-[11px] text-gray-400">v0.4.1</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Confirmation Modal for Delete */}
      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="이 노트를 삭제할까요? 전사 기록과 요약이 삭제되며 되돌릴 수 없습니다. (오디오 파일은 녹음 폴더에 그대로 남습니다)"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      {/* Edit Meeting Title Modal */}
      <Dialog open={editModalState.isOpen} onOpenChange={(open) => {
        if (!open) handleEditCancel();
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <VisuallyHidden>
            <DialogTitle>노트 이름 변경</DialogTitle>
          </VisuallyHidden>
          <div className="py-4">
            <h3 className="text-lg font-semibold mb-4">노트 이름 변경</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="meeting-title" className="block text-sm font-medium text-gray-700 mb-2">
                  노트 이름
                </label>
                <input
                  id="meeting-title"
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleEditConfirm();
                    } else if (e.key === 'Escape') {
                      handleEditCancel();
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="노트 이름을 입력하세요"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleEditCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleEditConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-note-green hover:bg-note-green-dark rounded-md transition-colors"
            >
              저장
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sidebar;
