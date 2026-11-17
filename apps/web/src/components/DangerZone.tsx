import { useEffect, useRef, useState } from 'react';

/**
 * Irreversible deletion. The user must type the exact name before the button enables,
 * so a stray tap on a phone cannot delete anything.
 */
export function DangerZone({
  title,
  description,
  buttonLabel,
  confirmName,
  onDelete,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  /** The text the user must type to confirm. */
  confirmName: string;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card danger-zone">
      <h2 className="card__title" style={{ margin: 0 }}>
        {title}
      </h2>
      <p className="muted small" style={{ margin: '6px 0 12px' }}>
        {description}
      </p>
      <button type="button" className="btn btn--danger-outline btn--block" onClick={() => setOpen(true)}>
        {buttonLabel}
      </button>
      {open && (
        <DeleteDialog
          title={buttonLabel}
          description={description}
          confirmName={confirmName}
          onCancel={() => setOpen(false)}
          onDelete={onDelete}
        />
      )}
    </section>
  );
}

function DeleteDialog({
  title,
  description,
  confirmName,
  onCancel,
  onDelete,
}: {
  title: string;
  description: string;
  confirmName: string;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const matches = typed.trim() === confirmName.trim();

  return (
    <div className="dialog-backdrop" onClick={() => !busy && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="delete-title">{title}</h2>
        <div className="dialog__body">
          <p style={{ margin: '0 0 8px' }}>{description}</p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>元に戻せません。</strong>確認のため「<strong>{confirmName}</strong>」と入力してください。
          </p>
          <label htmlFor="delete-confirm" className="visually-hidden">
            確認のための名前
          </label>
          <input
            id="delete-confirm"
            ref={inputRef}
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={!matches || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '削除中…' : '削除する'}
          </button>
        </div>
      </div>
    </div>
  );
}
