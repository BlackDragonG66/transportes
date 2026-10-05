import { useState } from "react";
import { api } from "./api.js";
export default function TaxiForm({ booking, trip, onSaved }) {
  const [open, setOpen] = useState(location.hash === "#taxi"),
    [zone, setZone] = useState(""),
    [passengers, setPassengers] = useState(booking.passengers),
    [luggage, setLuggage] = useState(0),
    [vehicles, setVehicles] = useState(Math.ceil(booking.passengers / 4)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const minimum = Math.ceil(passengers / 4),
    finished =
      ["arrived", "cancelled"].includes(trip.status) ||
      new Date(trip.arrival_at) <= new Date();
  return (
    <section id="taxi" className="box taxi-section">
      <p className="eyebrow">TU CONEXIÓN AL LLEGAR</p>
      <h2 className="title is-4">¿Te acercamos a tu destino?</h2>
      <p>
        Solicita un auto local para tu llegada a {trip.destination}. Solo
        necesitamos tu colonia o zona aproximada. Puedes decidirlo después del
        pago.
      </p>
      {finished ? (
        <p className="notification is-light mt-3">
          Este viaje ya terminó. Contacta a taquilla para consultar transporte
          local.
        </p>
      ) : !open ? (
        <button
          className="button is-primary mt-4"
          onClick={() => setOpen(true)}
        >
          Solicitar Viaje Rápido
        </button>
      ) : (
        <form
          className="mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api(`/bookings/${booking.id}/last-mile`, {
                method: "POST",
                body: { zone, passengers, luggage, vehicles },
              });
              await onSaved();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="label">
            Colonia o zona aproximada
            <input
              required
              minLength="2"
              maxLength="160"
              placeholder="Ej. Centro, Altozano, salida a Quiroga…"
              className="input mt-2"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            />
          </label>
          <div className="columns">
            <div className="column">
              <label className="label">
                Pasajeros
                <input
                  className="input"
                  type="number"
                  required
                  min="1"
                  max={booking.passengers}
                  value={passengers}
                  onChange={(e) => {
                    const n = Math.max(
                      1,
                      Math.min(booking.passengers, Number(e.target.value)),
                    );
                    setPassengers(n);
                    setVehicles((v) =>
                      Math.min(n, Math.max(v, Math.ceil(n / 4))),
                    );
                  }}
                />
              </label>
            </div>
            <div className="column">
              <label className="label">
                Maletas
                <input
                  className="input"
                  type="number"
                  required
                  min="0"
                  max="120"
                  value={luggage}
                  onChange={(e) => setLuggage(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="column">
              <label className="label">
                Autos
                <input
                  className="input"
                  type="number"
                  required
                  min={minimum}
                  max={passengers}
                  value={vehicles}
                  onChange={(e) => setVehicles(Number(e.target.value))}
                />
              </label>
            </div>
          </div>
          <p className="help mb-4">
            Máximo 4 pasajeros por auto. Para {passengers} pasajeros necesitas
            al menos {minimum} {minimum === 1 ? "auto" : "autos"}. La asignación
            depende de la disponibilidad y del espacio para equipaje. El costo
            del traslado se acuerda con taquilla; no está incluido en el boleto.
          </p>
          {error && (
            <p className="notification is-danger is-light" role="alert">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className={`button is-primary ${busy ? "is-loading" : ""}`}
          >
            Solicitar {vehicles} {vehicles === 1 ? "auto" : "autos"}
          </button>
        </form>
      )}
    </section>
  );
}
