/** Keeps one broken panel from taking the whole overlay down; the 3D view is never affected. */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createLogger } from '../../core/log';

const log = createLogger('ui');

interface Props {
  /** Shown in the fallback: "The {name} hit turbulence." */
  name: string;
  children: ReactNode;
}
interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    log.error(`${this.props.name} crashed`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="sd-panel sd-fallback" role="alert">
        <p className="sd-eyebrow">Instrument fault</p>
        <p className="sd-fallback__text">
          The {this.props.name} hit turbulence. The rest of the observatory is fine.
        </p>
        <button type="button" className="sd-btn" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}
