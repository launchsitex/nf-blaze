import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'
import { languageFromPath } from '../lib/language'

loader.config({ monaco })

interface Props {
  path: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
}

export default function CodeEditor({ path, value, onChange, onSave }: Props) {
  const saveRef = useRef(onSave)
  useEffect(() => {
    saveRef.current = onSave
  }, [onSave])

  return (
    <div className="monaco-wrap">
      <Editor
        height="100%"
        theme="vs-dark"
        path={path}
        language={languageFromPath(path)}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={{
          fontSize: 13,
          fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
          minimap: { enabled: false },
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          tabSize: 2,
          renderLineHighlight: 'line',
          padding: { top: 12 },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          bracketPairColorization: { enabled: true }
        }}
        onMount={(ed, mon) => {
          ed.addCommand(mon.KeyMod.CtrlCmd | mon.KeyCode.KeyS, () => {
            saveRef.current()
          })
        }}
      />
    </div>
  )
}
