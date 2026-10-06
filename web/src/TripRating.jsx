import { useState } from "react";
import { api } from "./api.js";
export default function TripRating({
  bookingId,
  jobId,
  title,
  review,
  onSaved,
}) {
  const [rating, setRating] = useState(review?.rating || 0),
    [comment, setComment] = useState(review?.comment || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/bookings/${bookingId}/reviews`, {
        method: "POST",
        body: {
          segment: jobId ? "local" : "interurban",
          ...(jobId ? { jobId } : {}),
          rating,
          comment,
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="trip-rating" onSubmit={submit}>
      <h3>{title}</h3>
      <p>¿Cómo estuvo tu experiencia?</p>
      <fieldset disabled={busy}>
        <legend className="is-sr-only">Calificación de 1 a 5 estrellas</legend>
        <div
          className="trip-rating-stars"
          role="radiogroup"
          aria-label={`Calificación: ${title}`}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={n <= rating ? "selected" : ""}>
              <input
                type="radio"
                name={jobId || "interurban-rating"}
                value={n}
                checked={rating === n}
                required
                onChange={() => {
                  setRating(n);
                  setSaved(false);
                }}
              />
              <span aria-hidden="true">★</span>
              <span className="is-sr-only">
                {n} {n === 1 ? "estrella" : "estrellas"}
              </span>
            </label>
          ))}
        </div>
        <label className="staff-vehicle-field">
          Comentario (opcional)
          <textarea
            className="textarea"
            maxLength="500"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setSaved(false);
            }}
            placeholder="Cuéntanos cómo estuvo tu viaje"
          />
        </label>
        <button className="button is-primary mt-3" disabled={busy || !rating}>
          {review ? "Actualizar calificación" : "Enviar calificación"}
        </button>
      </fieldset>
      {saved && (
        <p className="help is-success" role="status">
          Gracias, tu calificación quedó guardada.
        </p>
      )}
      {error && (
        <p className="help is-danger" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
