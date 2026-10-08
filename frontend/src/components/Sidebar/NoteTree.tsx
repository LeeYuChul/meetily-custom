'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, NotebookPen, Pencil, Trash2 } from 'lucide-react';
import { useSidebar } from './SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';

const OPEN_FOLDERS_KEY = 'meetily.sidebar.closedFolders';

interface NoteItem {
  id: string;
  title: string;
}

/** Pointer handler that starts dragging a note (HTML5 DnD is swallowed by Tauri's file-drop on Windows) */
export type StartNoteDrag = (e: React.PointerEvent, item: NoteItem) => void;

interface NoteTreeProps {
  /** Notes to show (already filtered by search) */
  items: NoteItem[];
  expanded: boolean;
  onToggleExpanded: () => void;
  searchQuery: string;
  isSearching: boolean;
  renderNote: (item: NoteItem, nested: boolean, startDrag: StartNoteDrag) => React.ReactNode;
}

const DRAG_THRESHOLD_PX = 6;
const ROOT_DROP = 'root';

function readClosedFolders(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function InlineNameInput({
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  // Enter/Escape unmount the input, which also fires blur; only the first outcome counts
  const settled = useRef(false);
  const finish = (submitValue: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (submitValue && value.trim()) onSubmit(value.trim());
    else onCancel();
  };
  const submit = () => finish(true);
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
        if (e.key === 'Escape') finish(false);
      }}
      onClick={(e) => e.stopPropagation()}
      className="min-w-0 flex-1 rounded border border-note-green bg-white px-1.5 py-0.5 text-sm text-gray-900 focus:outline-none"
    />
  );
}

/** "전체 노트": folders (collapsible, drop targets) followed by notes outside any folder */
export function NoteTree({ items, expanded, onToggleExpanded, searchQuery, isSearching, renderNote }: NoteTreeProps) {
  const { meetings, folders, createFolder, renameFolder, deleteFolder, moveNoteToFolder } = useSidebar();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder id, or ROOT_DROP
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const folderOfRef = useRef<Map<string, string | null>>(new Map());

  useEffect(() => setClosed(readClosedFolders()), []);

  const folderOf = useMemo(() => new Map(meetings.map((m) => [m.id, m.note_folder_id ?? null])), [meetings]);
  folderOfRef.current = folderOf;
  const searching = searchQuery.trim().length > 0;

  const toggleFolder = (id: string) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // Folder open state is a convenience only
      }
      return next;
    });
  };

  const startDrag: StartNoteDrag = (e, item) => {
    if (e.button !== 0) return;
    const origin = { x: e.clientX, y: e.clientY };
    let dragging = false;
    let target: string | null = null;

    const targetAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest('[data-note-drop]') as HTMLElement | null)?.dataset.noteDrop ?? null;

    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      target = targetAt(ev.clientX, ev.clientY);
      setDropTarget(target);
      setGhost({ title: item.title, x: ev.clientX, y: ev.clientY });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGhost(null);
      setDropTarget(null);
      if (!dragging) return;
      // The pointerup is followed by a click on the note; swallow it so the drop doesn't open the note
      window.addEventListener('click', (ce) => ce.stopPropagation(), { capture: true, once: true });
      if (target === null) return;
      const folderId = target === ROOT_DROP ? null : target;
      if ((folderOfRef.current.get(item.id) ?? null) !== folderId) void moveNoteToFolder(item.id, folderId);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const unfiled = items.filter((item) => !folderOf.get(item.id));
  const deleting = folders.find((f) => f.id === deleteTarget);

  return (
    <>
      <div
        data-note-drop={ROOT_DROP}
        className={`mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors ${
          dropTarget === ROOT_DROP ? 'bg-note-mint ring-1 ring-note-green' : 'hover:bg-gray-100'
        }`}
      >
        <button type="button" onClick={onToggleExpanded} className="flex flex-1 items-center gap-2.5 text-left" aria-expanded={expanded}>
          <NotebookPen className="h-4 w-4" />
          <span className="flex-1">전체 노트</span>
          {isSearching ? (
            <span className="animate-pulse text-xs text-note-green">검색 중</span>
          ) : (
            <span className="text-xs text-gray-400">{items.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!expanded) onToggleExpanded();
            setCreating(true);
          }}
          className="rounded p-0.5 text-gray-400 hover:bg-white hover:text-gray-700"
          title="새 폴더"
          aria-label="새 폴더"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
        <button type="button" onClick={onToggleExpanded} aria-label={expanded ? '접기' : '펼치기'}>
          {expanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
        </button>
      </div>

      {expanded && (
        <div className="custom-scrollbar mt-0.5 min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">
          {creating && (
            <div className="flex items-center gap-2 py-1 pl-5 pr-2">
              <Folder className="h-4 w-4 flex-shrink-0 text-note-green" />
              <InlineNameInput
                initial=""
                placeholder="새 폴더 이름"
                onSubmit={(name) => {
                  setCreating(false);
                  void createFolder(name);
                }}
                onCancel={() => setCreating(false)}
              />
            </div>
          )}

          {searching ? (
            items.length === 0 ? (
              <p className="py-2 pl-9 text-xs text-gray-400">검색 결과가 없습니다</p>
            ) : (
              items.map((item) => renderNote(item, false, startDrag))
            )
          ) : (
            <>
              {folders.map((folder) => {
                const notes = items.filter((item) => folderOf.get(item.id) === folder.id);
                const isOpen = !closed.has(folder.id);
                return (
                  <div key={folder.id}>
                    <div
                      data-note-drop={folder.id}
                      onClick={() => renamingId !== folder.id && toggleFolder(folder.id)}
                      className={`group flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-5 pr-2 text-sm text-gray-700 transition-colors ${
                        dropTarget === folder.id ? 'bg-note-mint ring-1 ring-note-green' : 'hover:bg-gray-100'
                      }`}
                    >
                      {isOpen ? (
                        <FolderOpen className="h-4 w-4 flex-shrink-0 text-note-green" />
                      ) : (
                        <Folder className="h-4 w-4 flex-shrink-0 text-note-green" />
                      )}
                      {renamingId === folder.id ? (
                        <InlineNameInput
                          initial={folder.name}
                          placeholder="폴더 이름"
                          onSubmit={(name) => {
                            setRenamingId(null);
                            if (name !== folder.name) void renameFolder(folder.id, name);
                          }}
                          onCancel={() => setRenamingId(null)}
                        />
                      ) : (
                        <>
                          <span className="flex-1 truncate font-medium">{folder.name}</span>
                          <span className="text-xs text-gray-400 group-hover:hidden">{notes.length}</span>
                          <div className="hidden items-center group-hover:flex">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenamingId(folder.id);
                              }}
                              className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700"
                              aria-label="폴더 이름 변경"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(folder.id);
                              }}
                              className="rounded p-1 text-gray-400 hover:bg-white hover:text-red-600"
                              aria-label="폴더 삭제"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    {isOpen && (
                      <div className="space-y-0.5">
                        {notes.length === 0 ? (
                          <p className="py-1 pl-12 text-[11px] text-gray-400">노트를 끌어다 놓으세요</p>
                        ) : (
                          notes.map((item) => renderNote(item, true, startDrag))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {unfiled.map((item) => renderNote(item, false, startDrag))}
              {items.length === 0 && folders.length === 0 && (
                <p className="py-2 pl-9 text-xs text-gray-400">아직 노트가 없습니다</p>
              )}
            </>
          )}
        </div>
      )}

      {ghost && (
        <div
          className="pointer-events-none fixed z-[100] max-w-[200px] truncate rounded-lg bg-gray-900/90 px-3 py-1.5 text-xs text-white shadow-lg"
          style={{ left: ghost.x + 12, top: ghost.y + 8 }}
        >
          {ghost.title}
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deleting}
        text={`'${deleting?.name ?? ''}' 폴더를 삭제할까요? 폴더 안의 노트는 삭제되지 않고 전체 노트로 옮겨집니다.`}
        onConfirm={() => {
          if (deleteTarget) void deleteFolder(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
