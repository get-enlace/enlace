import { useEffect, useRef, useState } from 'react';
import { InfoIcon, LockIcon } from '../chromeIcons.js';
import type { Credential, Operation } from '../../types.js';

/**
 * The sticky bar atop an operation node's config: credential lock + method
 * badge + path, and a "Help" info button that opens a small contextual
 * tooltip. Both popovers (credential picker, help tooltip) are entirely
 * self-contained here — open/closed state, outside-click, and Escape all
 * live in this component, not NodeConfig, since neither one's state means
 * anything outside this header.
 */
export function NodeConfigHeader({
  operation,
  selectedCredential,
  credentials,
  onSelectCredential,
  hasBody,
  selectedNodeId,
}: {
  operation: Operation;
  selectedCredential: Credential | null;
  credentials: Credential[];
  onSelectCredential: (credentialId: string | null) => void;
  /** Whether this operation has a request body at all — gates the body-only tips in the help tooltip (`$rand.` completion — see NodeConfig.tsx). */
  hasBody: boolean;
  /** Closes both popovers when the selected node changes, so a leftover menu doesn't sit open under a different operation's title. */
  selectedNodeId: string | null;
}) {
  const [credPickerOpen, setCredPickerOpen] = useState(false);
  const credPickerRef = useRef<HTMLDivElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!credPickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (credPickerRef.current && !credPickerRef.current.contains(e.target as Node)) {
        setCredPickerOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setCredPickerOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [credPickerOpen]);

  useEffect(() => {
    setCredPickerOpen(false);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!infoOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setInfoOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [infoOpen]);

  useEffect(() => {
    setInfoOpen(false);
  }, [selectedNodeId]);

  return (
    <div className="node-config__header" ref={credPickerRef}>
      <div className="node-config__op-title">
        <button
          type="button"
          className={`node-config__cred-lock${selectedCredential ? ' node-config__cred-lock--set' : ''}`}
          aria-label="Credential"
          aria-expanded={credPickerOpen}
          aria-haspopup="listbox"
          title={selectedCredential ? `Credential: ${selectedCredential.name}` : 'No credential'}
          onClick={() => setCredPickerOpen((open) => !open)}
        >
          <LockIcon />
        </button>
        <span className={`method-badge method-badge--${operation.method}`}>{operation.method.toUpperCase()}</span>
        <h2 className="node-config__path">{operation.path}</h2>
        <div className="node-config__info" ref={infoRef}>
          <button
            type="button"
            className="node-config__info-btn"
            aria-label="Help"
            aria-expanded={infoOpen}
            aria-haspopup="dialog"
            title="Tips for this request"
            onClick={() => setInfoOpen((open) => !open)}
          >
            <InfoIcon />
          </button>
          {infoOpen && (
            <div className="node-config__info-tooltip" role="tooltip">
              <p>
                Type <code>{'{{'}</code> inside a string to map a value from an upstream response.
              </p>
              {hasBody && (
                <p>
                  In the Body editor, type <code>{'$rand.'}</code> for a random value (autocompletes as you
                  type).
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {credPickerOpen && (
        <ul className="node-config__cred-menu" role="listbox" aria-label="Available credentials">
          <li role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={!selectedCredential}
              className={`node-config__cred-option${!selectedCredential ? ' node-config__cred-option--active' : ''}`}
              onClick={() => {
                onSelectCredential(null);
                setCredPickerOpen(false);
              }}
            >
              None
            </button>
          </li>
          {credentials.map((c) => (
            <li key={c.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={selectedCredential?.id === c.id}
                className={`node-config__cred-option${selectedCredential?.id === c.id ? ' node-config__cred-option--active' : ''}`}
                onClick={() => {
                  onSelectCredential(c.id);
                  setCredPickerOpen(false);
                }}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
