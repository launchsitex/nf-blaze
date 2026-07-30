import { useState } from 'react'
import type { FileNode } from '@shared/types'
import { ChevronDown, ChevronLeft, File, Folder } from 'lucide-react'

interface Props {
  nodes: FileNode[]
  selected: string | null
  onSelect: (relativePath: string) => void
  depth?: number
}

function TreeNode({
  node,
  selected,
  onSelect,
  depth = 0
}: {
  node: FileNode
  selected: string | null
  onSelect: (p: string) => void
  depth?: number
}) {
  const [open, setOpen] = useState(depth < 2)

  if (node.isDirectory) {
    return (
      <div>
        <button
          className="tree-item"
          style={{ paddingInlineStart: 8 + depth * 12 }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
          <Folder size={14} />
          <span>{node.name}</span>
        </button>
        {open && node.children && (
          <div className="tree-children">
            {node.children.map((c) => (
              <TreeNode
                key={c.relativePath}
                node={c}
                selected={selected}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      className={`tree-item ${selected === node.relativePath ? 'active' : ''}`}
      style={{ paddingInlineStart: 8 + depth * 12 }}
      onClick={() => onSelect(node.relativePath)}
    >
      <span style={{ width: 14 }} />
      <File size={14} />
      <span>{node.name}</span>
    </button>
  )
}

export default function FileTree({ nodes, selected, onSelect, depth = 0 }: Props) {
  return (
    <>
      {nodes.map((n) => (
        <TreeNode
          key={n.relativePath}
          node={n}
          selected={selected}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </>
  )
}
