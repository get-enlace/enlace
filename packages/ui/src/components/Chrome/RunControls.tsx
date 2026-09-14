/**
 * Header execution cluster. Segment that morphs between:
 * - idle: Run | Debug | Rerun failed (only once `canRerunFailed`)
 * - plain run: spinner | Stop
 * - debug: Continue | Step | Stop
 *
 * Width is a min, not a fixed value (see .run-segment in chrome.css) —
 * the idle row grows by one slot whenever Rerun failed is showable, rather
 * than reserving space for it up front (there's nothing to rerun before
 * anything's ever run, so a permanently-reserved slot would mostly sit
 * looking like a dead button).
 */
export function RunControls({
  isRunning,
  isDebugRun,
  pausedCount,
  canStep,
  canRerunFailed,
  onRun,
  onDebug,
  onRerunFailed,
  onContinue,
  onStep,
  onStop,
  stepTitle,
}: {
  isRunning: boolean;
  isDebugRun: boolean;
  pausedCount: number;
  canStep: boolean;
  /** Whether the last run left something unfinished — see store/slices/runSlice.ts's `hasResumableFailure`. */
  canRerunFailed: boolean;
  onRun: () => void;
  onDebug: () => void;
  onRerunFailed: () => void;
  onContinue: () => void;
  onStep: () => void;
  onStop: () => void;
  stepTitle: string;
}) {
  if (isRunning && isDebugRun) {
    return (
      <div className="run-segment" role="group" aria-label="Debug controls">
        <button
          type="button"
          className="run-segment__btn run-segment__btn--primary"
          onClick={onContinue}
          disabled={pausedCount === 0}
          title="Continue — release every node currently paused"
          aria-label="Continue"
        >
          <PlayIcon />
        </button>
        <button
          type="button"
          className="run-segment__btn run-segment__btn--ghost"
          onClick={onStep}
          disabled={!canStep}
          title={stepTitle}
          aria-label="Step"
        >
          <StepIcon />
        </button>
        <button
          type="button"
          className="run-segment__btn run-segment__btn--stop"
          onClick={onStop}
          title="Stop — nothing new fires; anything already in flight still completes"
          aria-label="Stop"
        >
          <StopIcon />
        </button>
      </div>
    );
  }

  if (isRunning) {
    return (
      <div className="run-segment" role="group" aria-label="Run in progress">
        <div className="run-segment__btn run-segment__btn--primary run-segment__btn--status" aria-live="polite">
          <SpinnerIcon />
          <span className="run-segment__sr-only">Running</span>
        </div>
        <button
          type="button"
          className="run-segment__btn run-segment__btn--stop"
          onClick={onStop}
          title="Stop — nothing new fires; anything already in flight still completes"
          aria-label="Stop"
        >
          <StopIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="run-segment" role="group" aria-label="Run controls">
      {/* Run vs Debug stay two distinct actions — same shell, different
          semantics (plain run ignores breakpoints; Debug honors them). */}
      <button type="button" className="run-segment__btn run-segment__btn--primary" onClick={onRun}>
        <PlayIcon />
        <span>Run</span>
      </button>
      <button
        type="button"
        className="run-segment__btn run-segment__btn--debug"
        onClick={onDebug}
        title="Run, honoring any breakpoints armed on the canvas"
      >
        <BreakpointIcon />
        <span>Debug</span>
      </button>
      {/* Own color (teal, not Debug's amber or Run's green) so it reads as
          a third distinct action, not a variant of either — see .run-segment__btn--rerun. */}
      {canRerunFailed && (
        <button
          type="button"
          className="run-segment__btn run-segment__btn--rerun"
          onClick={onRerunFailed}
          title="Rerun failed — skips nodes that already completed in the last run, retries the rest from where it stopped"
        >
          <RetryIcon />
          <span>Rerun failed</span>
        </button>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg className="run-segment__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path fill="currentColor" d="M4 2.5v11l9-5.5L4 2.5z" />
    </svg>
  );
}

function BreakpointIcon() {
  return (
    <svg className="run-segment__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path fill="currentColor" d="M8 2.5 13.5 8 8 13.5 2.5 8 8 2.5z" />
    </svg>
  );
}

function StepIcon() {
  return (
    <svg className="run-segment__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path fill="currentColor" d="M2.5 3v10l5.5-5L2.5 3zm7 0v10h1.5V3H9.5zm3 0v10H14V3h-1.5z" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg className="run-segment__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M13 8a5 5 0 1 1-1.6-3.65" />
      <path fill="currentColor" d="M13.6 2.6l.4 3.2-3-1.2z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="run-segment__icon" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <rect fill="currentColor" x="3.5" y="3.5" width="9" height="9" rx="1" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="run-segment__icon run-segment__spinner"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"
      />
    </svg>
  );
}
