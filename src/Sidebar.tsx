import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import type { Folder, Library, ProjectMeta } from './storage'

export type NodeRef = { kind: 'folder' | 'project'; id: string }

interface Props {
  lib: Library
  targetFolder: string | null
  renaming: string | null
  onTargetFolder: (id: string | null) => void
  onRenaming: (id: string | null) => void
  onOpen: (id: string) => void
  onNewProject: (folderId: string | null) => void
  onNewFolder: (parentId: string | null) => void
  onRename: (node: NodeRef, name: string) => void
  onDuplicate: (id: string) => void
  onDelete: (node: NodeRef) => void
  onMove: (node: NodeRef, folderId: string | null) => void
  onToggleFolder: (id: string) => void
}

const DRAG_TYPE = 'application/x-flyer-node'
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

function edited(t: number): string {
  const d = new Date(t)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? `Edited ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : `Edited ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}

const Icon = {
  chevron: (open: boolean) => (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }}>
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  dots: (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </svg>
  ),
}

export default function Sidebar(props: Props) {
  const { lib, targetFolder, renaming } = props
  const [menu, setMenu] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.tree-menu, .row-more')) {
        setMenu(null)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  function openMenu(id: string) {
    setMenu(menu === id ? null : id)
    setConfirmDelete(false)
  }

  function dropProps(folderId: string | null) {
    return {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        setDropTarget(folderId)
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(undefined)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDropTarget(undefined)
        const raw = e.dataTransfer.getData(DRAG_TYPE)
        if (raw) props.onMove(JSON.parse(raw) as NodeRef, folderId)
      },
    }
  }

  function dragProps(node: NodeRef) {
    return {
      draggable: renaming !== node.id,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(node))
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragEnd: () => {
        setDropTarget(undefined)
      },
    }
  }

  function renderMenu(node: NodeRef, children: ReactNode) {
    return (
      <div className="tree-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenu(null); props.onRenaming(node.id) }}>
          Rename
        </button>
        {children}
        {confirmDelete ? (
          <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); props.onDelete(node) }}>
            {node.kind === 'folder' ? 'Delete folder, keep its flyers' : 'Delete for good'}
          </button>
        ) : (
          <button type="button" role="menuitem" className="danger" onClick={() => setConfirmDelete(true)}>
            Delete…
          </button>
        )}
      </div>
    )
  }

  function renderFolder(f: Folder, depth: number) {
    const node: NodeRef = { kind: 'folder', id: f.id }
    return (
      <li key={f.id}>
        <div
          className={
            'row row-folder' +
            (targetFolder === f.id ? ' is-target' : '') +
            (dropTarget === f.id ? ' is-drop' : '')
          }
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            props.onToggleFolder(f.id)
            props.onTargetFolder(f.id)
          }}
          {...dragProps(node)}
          {...dropProps(f.id)}
        >
          <span className="row-chevron">{Icon.chevron(!f.collapsed)}</span>
          <span className="row-icon">{Icon.folder}</span>
          {renderName(node, f.name)}
          <span className="row-actions">
            <button
              type="button"
              className="icon-btn"
              title="New flyer in this folder"
              onClick={(e) => {
                e.stopPropagation()
                props.onNewProject(f.id)
              }}
            >
              {Icon.plus}
            </button>
            <button
              type="button"
              className="icon-btn row-more"
              title="More"
              aria-expanded={menu === f.id}
              onClick={(e) => {
                e.stopPropagation()
                openMenu(f.id)
              }}
            >
              {Icon.dots}
            </button>
          </span>
        </div>
        {menu === f.id && (
          renderMenu(
            node,
            <button type="button" role="menuitem" onClick={() => { setMenu(null); props.onNewFolder(f.id) }}>
              New folder inside
            </button>,
          )
        )}
        {!f.collapsed && renderTree(f.id, depth + 1)}
      </li>
    )
  }

  function renderProject(p: ProjectMeta, depth: number) {
    const node: NodeRef = { kind: 'project', id: p.id }
    const current = lib.currentId === p.id
    return (
      <li key={p.id}>
        <div
          className={'row row-project' + (current ? ' is-current' : '')}
          style={{ paddingLeft: 8 + depth * 14 + 14 }}
          onClick={() => {
            props.onTargetFolder(p.folderId)
            if (!current) props.onOpen(p.id)
          }}
          aria-current={current ? 'page' : undefined}
          {...dragProps(node)}
        >
          <span className="row-thumb">{p.thumb && <img src={p.thumb} alt="" draggable={false} />}</span>
          <span className="row-text">
            {renderName(node, p.name)}
            <span className="row-meta">{edited(p.updatedAt)}</span>
          </span>
          <span className="row-actions">
            <button
              type="button"
              className="icon-btn row-more"
              title="More"
              aria-expanded={menu === p.id}
              onClick={(e) => {
                e.stopPropagation()
                openMenu(p.id)
              }}
            >
              {Icon.dots}
            </button>
          </span>
        </div>
        {menu === p.id && (
          renderMenu(
            node,
            <button type="button" role="menuitem" onClick={() => { setMenu(null); props.onDuplicate(p.id) }}>
              Duplicate
            </button>,
          )
        )}
      </li>
    )
  }

  function renderName(node: NodeRef, name: string) {
    if (renaming !== node.id) return <span className="row-name">{name}</span>
    return (
      <input
        className="row-input"
        aria-label="Name"
        defaultValue={name}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.currentTarget.value = name
            e.currentTarget.blur()
          }
        }}
        onBlur={(e) => {
          props.onRename(node, e.currentTarget.value)
          props.onRenaming(null)
        }}
      />
    )
  }

  function renderTree(parentId: string | null, depth: number): ReactNode {
    const folders = lib.folders.filter((f) => f.parentId === parentId).sort(byName)
    const projects = lib.projects.filter((p) => p.folderId === parentId).sort(byName)
    if (!folders.length && !projects.length) {
      return depth ? <p className="tree-empty" style={{ paddingLeft: 8 + depth * 14 + 14 }}>Empty folder</p> : null
    }
    return (
      <ul className="tree">
        {folders.map((f) => renderFolder(f, depth))}
        {projects.map((p) => renderProject(p, depth))}
      </ul>
    )
  }

  const targetName = lib.folders.find((f) => f.id === targetFolder)?.name
  return (
    <nav className="sidebar" aria-label="Projects">
      <div className="sidebar-head">
        <h2 className="panel-title">Projects</h2>
        <div className="sidebar-actions">
          <button type="button" className="btn btn-small" onClick={() => props.onNewProject(targetFolder)}>
            {Icon.plus} Flyer
          </button>
          <button type="button" className="btn btn-small" onClick={() => props.onNewFolder(targetFolder)}>
            {Icon.plus} Folder
          </button>
        </div>
        <p className="sidebar-target">
          New items go in <b>{targetName ?? 'the top level'}</b>
        </p>
      </div>
      <div
        className={'sidebar-tree' + (dropTarget === null ? ' is-drop' : '')}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onTargetFolder(null)
        }}
        {...dropProps(null)}
      >
        {renderTree(null, 0)}
        <p className="sidebar-foot">Drag flyers and folders to reorganise. Saved in this browser.</p>
      </div>
    </nav>
  )
}
