import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  private reload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="runtime-gate">
        <div className="runtime-gate-card">
          <div className="runtime-gate-icon">
            <TriangleAlert size={28} />
          </div>
          <h1>קרתה תקלה בלתי צפויה</h1>
          <p className="runtime-gate-lead">
            הממשק נתקל בשגיאה ולא יכול להמשיך להציג את המסך הזה.
          </p>
          <p className="runtime-gate-help" dir="ltr" style={{ textAlign: 'left' }}>
            {error.message}
          </p>
          <div className="runtime-gate-actions">
            <button className="btn btn-primary" onClick={this.reload}>
              <RefreshCw size={16} />
              רענון האפליקציה
            </button>
            <button className="btn btn-ghost" onClick={this.reset}>
              נסה להמשיך בלי רענון
            </button>
          </div>
        </div>
      </div>
    )
  }
}
