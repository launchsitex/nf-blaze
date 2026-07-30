import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function App() {
  const [name, setName] = useState('')

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-8 px-6 py-12">
      <header className="space-y-3 text-start">
        <p className="text-sm font-medium text-primary">NF-Blaze · תבנית אתר</p>
        <h1 className="text-4xl font-bold tracking-tight">ברוכים הבאים</h1>
        <p className="max-w-xl text-muted-foreground">
          תבנית Vite + React + TypeScript + Tailwind + shadcn, עם עברית ו-RTL מובנים.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>התחלה מהירה</CardTitle>
          <CardDescription>הזינו שם — הקומפוננטות מיושרות ל-RTL כברירת מחדל.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Input
            placeholder="השם שלכם"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="sm:flex-1"
            aria-label="שם"
          />
          <Button type="button" className="shrink-0">
            <Sparkles className="size-4" />
            {name.trim() ? `שלום, ${name.trim()}` : 'המשיכו'}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
