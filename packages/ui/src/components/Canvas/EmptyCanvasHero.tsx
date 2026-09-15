const STEPS: Array<{ title: string; desc: string }> = [
  { title: 'Drag and drop', desc: 'Add operations from the left panel.' },
  { title: 'Connect', desc: 'Link operations to define the flow.' },
  { title: 'Configure', desc: 'Set inputs, headers and parameters.' },
  { title: 'Run', desc: 'Execute and see results in real time.' },
];

/** First-load guidance, rendered by Canvas only while the workflow has no nodes. */
export function EmptyCanvasHero({ onAddFirstOperation }: { onAddFirstOperation?: () => void }) {
  return (
    <div className="canvas-hero" data-testid="canvas-hero">
      <div className="canvas-hero__card">
        <span className="canvas-hero__mark" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        </span>
        <h2>Build your first workflow</h2>
        <p className="canvas-hero__lead">
          Drag operations from the left panel and connect them to design and run your API workflow.
        </p>
        <ol className="canvas-hero__steps">
          {STEPS.map((step) => (
            <li key={step.title} className="canvas-hero__step">
              <span className="canvas-hero__step-title">{step.title}</span>
              <span className="canvas-hero__step-desc">{step.desc}</span>
            </li>
          ))}
        </ol>
        <button type="button" className="canvas-hero__cta" onClick={onAddFirstOperation}>
          + Add your first operation
        </button>
        <p className="canvas-hero__hint">Or drag an operation from the left panel. Wait and Assert live in the Presets tab.</p>
      </div>
    </div>
  );
}
