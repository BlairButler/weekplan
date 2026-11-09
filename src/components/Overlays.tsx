import { useEffect, useState } from "react";
import { unplaceableText, useStore } from "../lib/store";
import { fmtHours, fmtMinutesOfDay, fmtTime, MIN, minutesOfDay, parseHHMM, SNAP, startOfDay } from "../lib/time";

export function PreviewBar() {
  const preview = useStore((s) => s.preview);
  const categories = useStore((s) => s.categories);
  const { acceptPreview, discardPreview } = useStore.getState();
  if (!preview) return null;
  const { plan } = preview;
  const added = plan.add.reduce((s, a) => s + (a.end - a.start) / MIN, 0);
  const moved = Object.keys(plan.moves).length;
  const unplaced = unplaceableText(plan, categories);
  return (
    <div className="preview-bar" role="status">
      <div>
        <b>{preview.reason}</b>
        <span>
          {plan.add.length > 0 && ` ${plan.add.length} new block${plan.add.length > 1 ? "s" : ""} (${fmtHours(added)})`}
          {moved > 0 && ` · ${moved} moved`}
          {plan.remove.length > 0 && ` · ${plan.remove.length} removed`}
          {unplaced && ` · couldn't fit ${unplaced}`}
        </span>
        <small>Drag the dashed blocks to adjust before accepting.</small>
      </div>
      <button onClick={discardPreview}>Discard</button>
      <button className="primary" onClick={acceptPreview}>
        Accept
      </button>
    </div>
  );
}

export function ToastView() {
  const toast = useStore((s) => s.toast);
  const { undo } = useStore.getState();
  if (!toast) return null;
  return (
    <div className="toast" key={toast.id}>
      <span>{toast.text}</span>
      {toast.undo && (
        <button className="link" onClick={undo}>
          Undo
        </button>
      )}
    </div>
  );
}

export function CheckInDialog() {
  const occ = useStore((s) => s.checkIn);
  const { setCheckIn, updateOcc } = useStore.getState();
  const [early, setEarly] = useState(false);
  const [stopAt, setStopAt] = useState(0);

  useEffect(() => {
    if (occ) {
      setEarly(false);
      setStopAt(minutesOfDay(occ.end - 60 * MIN));
    }
  }, [occ]);
  if (!occ) return null;

  const day = startOfDay(occ.start);
  const confirmEarly = () => {
    let end = new Date(day).setHours(0, stopAt, 0, 0);
    end = Math.max(occ.start + SNAP * MIN, Math.min(occ.end, end));
    if (end < occ.end) updateOcc(occ, { end });
    setCheckIn(null);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal small">
        <h2>{occ.title} block finished</h2>
        <p>
          Scheduled {fmtTime(occ.start)} – {fmtTime(occ.end)}. Did you get through it?
        </p>
        {early ? (
          <>
            <label>
              I stopped at
              <input type="time" step={1800} value={fmtMinutesOfDay(stopAt)} onChange={(e) => setStopAt(parseHHMM(e.target.value))} />
            </label>
            <p className="hint">The missed time will be re-placed later this week (if the week has been planned).</p>
            <div className="modal-actions">
              <button onClick={() => setEarly(false)}>Back</button>
              <span className="spacer" />
              <button className="primary" onClick={confirmEarly}>
                Save
              </button>
            </div>
          </>
        ) : (
          <div className="modal-actions">
            <button onClick={() => setEarly(true)}>Stopped early…</button>
            <span className="spacer" />
            <button className="primary" autoFocus onClick={() => setCheckIn(null)}>
              Yes, finished
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
