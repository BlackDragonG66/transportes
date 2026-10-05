import useModalFocus from "./useModalFocus.js";
export default function StaffConfirm({
  title,
  children,
  busy,
  onCancel,
  onConfirm,
}) {
  useModalFocus(true, () => {
    if (!busy) onCancel();
  });
  return (
    <div
      className="modal is-active"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="modal-background"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="modal-content">
        <div className="box">
          <h2 className="title is-4">{title}</h2>
          {children}
          <div className="buttons mt-5">
            <button
              className={`button is-primary ${busy ? "is-loading" : ""}`}
              disabled={busy}
              onClick={onConfirm}
            >
              Confirmar
            </button>
            <button className="button" disabled={busy} onClick={onCancel}>
              Volver
            </button>
          </div>
        </div>
      </div>
      <button
        className="modal-close is-large"
        aria-label="Cerrar confirmación"
        disabled={busy}
        onClick={onCancel}
      />
    </div>
  );
}
