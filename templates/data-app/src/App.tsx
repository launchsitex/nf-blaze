import { useEffect, useState } from 'react'
import { Database, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'

type Status = 'idle' | 'checking' | 'ok' | 'error' | 'missing'

export default function App() {
  const [name, setName] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [detail, setDetail] = useState('')

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setStatus('missing')
      setDetail('חסרים VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — העתיקו מ-.env.example')
      return
    }
    setStatus('checking')
    void supabase.auth.getSession().then(({ error }) => {
      if (error) {
        setStatus('error')
        setDetail(error.message)
        return
      }
      setStatus('ok')
      setDetail('הלקוח מוכן. חברו פרויקט Supabase והפעילו RLS.')
    })
  }, [])

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-8 px-6 py-12">
      <header className="space-y-3 text-start">
        <p className="text-sm font-medium text-primary">NF-Blaze · תבנית נתונים</p>
        <h1 className="text-4xl font-bold tracking-tight">אפליקציה עם Supabase</h1>
        <p className="max-w-xl text-muted-foreground">
          אותו בסיס Vite/React/Tailwind/shadcn, עם לקוח Supabase מוכן בעברית ו-RTL.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5" />
            מצב חיבור
          </CardTitle>
          <CardDescription>
            {status === 'checking' && 'בודק את הלקוח…'}
            {status === 'ok' && 'מחובר (לקוח מוכן)'}
            {status === 'missing' && 'חסרים משתני סביבה'}
            {status === 'error' && 'שגיאה בחיבור'}
            {status === 'idle' && 'ממתין…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-start">{detail}</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Input
              placeholder="שם לתצוגה"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="sm:flex-1"
              aria-label="שם"
            />
            <Button type="button" className="shrink-0">
              <Sparkles className="size-4" />
              {name.trim() ? `שלום, ${name.trim()}` : 'המשיכו'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
