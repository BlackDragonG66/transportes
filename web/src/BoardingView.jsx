import { useEffect, useState } from "react";
import { api, date, money } from "./api.js";
import TaxiForm from "./TaxiForm.jsx";
import TripProgress from "./TripProgress.jsx";
import TripRating from "./TripRating.jsx";
const labels = {
  pending: "Pendiente de pago",
  confirmed: "Confirmada",
  expired: "Reserva vencida",
  refund_required: "Reembolso requerido",
  refunded: "Reembolsada",
  cancelled: "Cancelada",
  scheduled: "Programado",
  boarding: "Abordaje",
  en_route: "En ruta",
  arrived: "Llegó a destino",
  waiting: "Buscando chofer",
  accepted: "Chofer asignado",
  completed: "Completado",
};
export default function BoardingView({ mode, token, user }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setData(await api(`/${mode}/${token}`));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [mode, token, user]);
  if (error && !data)
    return <div className="notification is-warning">{error}</div>;
  if (!data) return <p>Cargando datos del viaje…</p>;
  const t = data.trip || data,
    b = data.booking;
  async function share() {
    const url = `${location.origin}/tracking/${b.share_token}`;
    try {
      if (navigator.share)
        await navigator.share({
          title: "Mi viaje ConexionES",
          text: `${t.origin} → ${t.destination}`,
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        setMessage("Enlace copiado.");
      }
    } catch (e) {
      if (e.name !== "AbortError") setMessage("No se pudo compartir.");
    }
  }
  async function board() {
    try {
      await api(`/ticket/${token}/board`, { method: "POST" });
      await load();
      setMessage("Abordaje registrado.");
    } catch (e) {
      setMessage(e.message);
    }
  }
  return (
    <div className="boarding-wrap">
      {data.isDemo && (
        <p className="notification is-warning is-light">
          BOLETO DE DEMOSTRACIÓN · Pago simulado, sin cargo real.
        </p>
      )}
      <div className="box">
        <p className="eyebrow">CONEXIONES · VIAJA CON CONFIANZA</p>
        <h1 className="title is-3">
          {t.origin} → {t.destination}
        </h1>
        <span className="tag is-primary is-light is-medium">
          {labels[t.status] || t.status}
        </span>
        <TripProgress status={t.status} />
        <p className="mt-4">
          Salida: {date(t.departure_at)}
          <br />
          Llegada estimada: {date(t.arrival_at)}
        </p>
        <hr />
        <div className="driver-card">
          <img
            className="driver-photo"
            src={t.photo_url}
            alt={`Foto de ${t.driver_name}`}
          />
          <div>
            <p className="is-size-7">TU CONDUCTOR</p>
            <h2 className="title is-4 mb-2">{t.driver_name}</h2>
            <p>
              {t.brand} {t.model}
            </p>
            <strong className="plate">{t.plate}</strong>
          </div>
        </div>
        {b && (
          <>
            <hr />
            <h2 className="title is-5">Tu boleto</h2>
            <p>
              <strong>{labels[b.status]}</strong> · {b.passengers} pasajero(s) ·{" "}
              {money(b.total_cents)}
            </p>
            <p className="help">Folio: {b.id}</p>
            {b.status === "pending" &&
              (data.integrations?.payments ? (
                <button
                  className="button is-primary mt-3"
                  onClick={async () => {
                    try {
                      const p = await api(`/bookings/${b.id}/preference`, {
                        method: "POST",
                      });
                      location.assign(p.checkout_url);
                    } catch (e) {
                      setMessage(e.message);
                    }
                  }}
                >
                  Continuar pago
                </button>
              ) : (
                <p className="notification is-warning is-light mt-3">
                  Pago online pendiente de configuración. Contacta a taquilla.
                </p>
              ))}
            {data.travelers?.length > 0 && (
              <div className="review-card mt-4">
                <h3>Pasajeros del boleto</h3>
                {data.travelers.map((p) => (
                  <p key={p.position}>
                    <strong>{p.full_name}</strong>
                    <span>{p.passenger_type}</span>
                  </p>
                ))}
              </div>
            )}
            {b.status === "confirmed" && (
              <>
                <img className="ticket-qr" src={data.qr} alt="QR del boleto" />
                <div className="buttons">
                  <button className="button is-primary" onClick={share}>
                    Compartir mi viaje
                  </button>
                  {user?.role === "admin" && (
                    <button
                      disabled={Boolean(b.boarded_at)}
                      className="button is-link"
                      onClick={board}
                    >
                      {b.boarded_at
                        ? "Abordaje registrado"
                        : "Validar abordaje"}
                    </button>
                  )}
                </div>
              </>
            )}
            {data.local?.length > 0 && (
              <>
                <h3 className="title is-5 mt-5">Tu conexión al llegar</h3>
                {data.local.map((j, i) => (
                  <div className="notification is-light" key={i}>
                    <strong>
                      Auto {i + 1}: {labels[j.status]}
                    </strong>
                    <TripProgress
                      title={`Traslado local · Auto ${i + 1}`}
                      status={j.status}
                      started={j.started_at}
                    />
                    <p>
                      {j.zone} · {j.passengers} pasajeros · {j.luggage} maletas
                    </p>
                    {j.driver_name && (
                      <p>
                        {j.driver_name} · {j.phone}
                        <br />
                        {j.model} · {j.plate}
                      </p>
                    )}
                    {data.canReview && j.status === "completed" && (
                      <TripRating
                        bookingId={b.id}
                        jobId={j.id}
                        title={`Califica tu traslado · ${j.driver_name}`}
                        review={data.reviews?.find((r) => r.job_id === j.id)}
                        onSaved={load}
                      />
                    )}
                  </div>
                ))}
              </>
            )}
            {data.canReview && t.status === "arrived" && (
              <TripRating
                bookingId={b.id}
                title={`Califica tu viaje · ${t.driver_name}`}
                review={data.reviews?.find((r) => r.segment === "interurban")}
                onSaved={load}
              />
            )}
          </>
        )}
        {message && (
          <p role="status" className="notification mt-3">
            {message}
          </p>
        )}
        {error && <p className="help is-danger">{error}</p>}
      </div>
      {mode === "tracking" && data.local?.length > 0 && (
        <div className="box">
          <h2 className="title is-5">Conexión en Taxi / Uber</h2>
          {data.local.map((j, i) => (
            <div key={i} className="mb-5">
              <TripProgress
                title={`Auto ${i + 1}`}
                status={j.status}
                started={j.started_at}
              />
              {j.driver_name && (
                <p>
                  {j.driver_name} · {j.model} · {j.plate}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {mode === "tracking" && t.status === "arrived" && (
        <p className="notification is-light">
          ¿Viajaste con nosotros?{" "}
          <a href="/#bookings">
            Abre tu boleto en Mis reservas para calificar tu experiencia.
          </a>
        </p>
      )}
      {data.canRequestLocal && !data.lastMile && (
        <TaxiForm booking={b} trip={t} onSaved={load} />
      )}
    </div>
  );
}
