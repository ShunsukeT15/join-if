import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { copyText } from '../lib/clipboard';

// ---------- Layout ----------

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="app-header">
        <div className="app-header__inner">
          <Link to="/" className="brand" aria-label="Join if トップへ">
            <span className="brand__mark" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Join if
          </Link>
        </div>
      </header>
      <main className="container">{children}</main>
      <footer className="app-footer">
        <Link to="/terms">利用規約</Link>
        <Link to="/privacy">プライバシーポリシー</Link>
        <span>© Join if</span>
      </footer>
    </>
  );
}

export function Spinner({ label = '読み込み中' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <div className="spinner" />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export function Notice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warn' | 'danger' | 'success';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

// ---------- Toast ----------

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status" aria-live="polite">
          {msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Copy ----------

export function CopyButton({
  text,
  label,
  done = 'コピーしました',
  variant = 'secondary',
  size,
}: {
  text: string;
  label: string;
  done?: string;
  variant?: 'primary' | 'secondary';
  size?: 'sm';
}) {
  const toast = useToast();
  return (
    <button
      type="button"
      className={`btn btn--${variant}${size ? ` btn--${size}` : ''}`}
      onClick={async () => toast((await copyText(text)) ? done : 'コピーできませんでした。長押しで選択してください')}
    >
      {label}
    </button>
  );
}

export function UrlBox({ url, copyLabel = 'コピー' }: { url: string; copyLabel?: string }) {
  return (
    <div className="url-box">
      <span className="url-box__text" title={url}>
        {url}
      </span>
      <CopyButton text={url} label={copyLabel} size="sm" variant="primary" done="URLをコピーしました" />
    </div>
  );
}

// ---------- Confirm dialog ----------

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

export function ConfirmDialog({
  options,
  onConfirm,
  onCancel,
  busy,
}: {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dialog-title">{options.title}</h2>
        <div className="dialog__body">{options.body}</div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>
            キャンセル
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${options.danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hook: `ask(options, action)` opens a dialog and runs `action` on confirm. */
export function useConfirm() {
  const [state, setState] = useState<{ options: ConfirmOptions; action: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useCallback((options: ConfirmOptions, action: () => Promise<void>) => setState({ options, action }), []);
  const cancel = useCallback(() => !busy && setState(null), [busy]);
  const dialog = state ? (
    <ConfirmDialog
      options={state.options}
      busy={busy}
      onCancel={cancel}
      onConfirm={async () => {
        setBusy(true);
        try {
          await state.action();
        } finally {
          setBusy(false);
          setState(null);
        }
      }}
    />
  ) : null;
  return { ask, dialog };
}
