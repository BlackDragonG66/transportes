import { useEffect, useRef, useState } from "react";
import { api, money, date } from "./api.js";
const day = (v) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(v));
const clock = (v) =>
  new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
const steps = ["Tu viaje", "Pasajeros", "Extras", "Pago"];
function saved() {
  try {
    const v = JSON.parse(sessionStorage.getItem("conexiones-draft"));
    return v && Date.now() - v.savedAt < 86400000 ? v : {};
  } catch {
    return {};
  }
}
export default function ReservationForm({
  user,
  pos = false,
  cashSession,
  customers = [],
  onLogin = () => {},
  onStageChange = () => {},
}) {
  const initial = useRef(pos ? {} : saved()).current;
  const [catalog, setCatalog] = useState(null),
    [step, setStep] = useState(0),
    [origin, setOrigin] = useState(initial.origin || "Apatzingán"),
    [destination, setDestination] = useState(initial.destination || "Morelia"),
    [travelDate, setDate] = useState(initial.travelDate || day(Date.now())),
    [count, setCount] = useState(initial.count || 1),
    [tripId, setTrip] = useState(initial.tripId || ""),
    [travelers, setTravelers] = useState(
      initial.travelers || [{ name: "", passengerTypeId: "" }],
    ),
    [extras, setExtras] = useState(initial.extras || {}),
    [customerId, setCustomer] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [booking, setBooking] = useState(null);
  const attempt = useRef(null),
    heading = useRef(null);
  async function load() {
    try {
      setCatalog(await api("/catalog"));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    onStageChange(step);
    if (step) heading.current?.focus();
  }, [step]);
  useEffect(() => {
    if (!pos && !booking)
      try {
        sessionStorage.setItem(
          "conexiones-draft",
          JSON.stringify({
            origin,
            destination,
            travelDate,
            count,
            tripId,
            travelers,
            extras,
            savedAt: Date.now(),
          }),
        );
      } catch {}
  }, [
    origin,
    destination,
    travelDate,
    count,
    tripId,
    travelers,
    extras,
    booking,
    pos,
  ]);
  const routes = catalog?.routes || [],
    origins = [...new Set(routes.map((r) => r.origin))],
    destinations = [
      ...new Set(
        routes.filter((r) => r.origin === origin).map((r) => r.destination),
      ),
    ];
  const routeIds = routes
    .filter((r) => r.origin === origin && r.destination === destination)
    .map((r) => r.id);
  const matching = (catalog?.trips || []).filter(
      (t) => routeIds.includes(t.route_id) && Number(t.available) >= count,
    ),
    departures = matching.filter((t) => day(t.departure_at) === travelDate),
    next = matching.find((t) => day(t.departure_at) >= travelDate);
  const trip = catalog?.trips.find((t) => t.id === tripId),
    fares = catalog?.fares.filter((f) => f.route_id === trip?.route_id) || [];
  const types = (catalog?.types || []).filter((t) =>
    fares.some((f) => f.passenger_type_id === t.id),
  );
  const base = travelers.reduce(
      (sum, t) =>
        sum +
        (fares.find((f) => f.passenger_type_id === t.passengerTypeId)
          ?.price_cents || 0),
      0,
    ),
    addonTotal = (catalog?.addons || []).reduce(
      (sum, a) => sum + a.price_cents * (extras[a.id] || 0),
      0,
    ),
    fee = pos ? 0 : count * 1000;
  function changeCount(n) {
    setCount(n);
    setTrip("");
    setTravelers((old) =>
      Array.from(
        { length: n },
        (_, i) => old[i] || { name: "", passengerTypeId: "" },
      ),
    );
  }
  function choose(t) {
    setTrip(t.id);
    const type =
      catalog.types.find(
        (p) =>
          p.name === "Adulto" &&
          catalog.fares.some(
            (f) => f.route_id === t.route_id && f.passenger_type_id === p.id,
          ),
      ) ||
      catalog.types.find((p) =>
        catalog.fares.some(
          (f) => f.route_id === t.route_id && f.passenger_type_id === p.id,
        ),
      );
    setTravelers((old) =>
      old.map((p) => ({
        ...p,
        passengerTypeId: catalog.fares.some(
          (f) =>
            f.route_id === t.route_id &&
            f.passenger_type_id === p.passengerTypeId,
        )
          ? p.passengerTypeId
          : type?.id || "",
      })),
    );
  }
  function advance(e) {
    e.preventDefault();
    setError("");
    if (step === 0 && (!trip || !departures.some((t) => t.id === trip.id))) {
      setError("Selecciona una salida disponible.");
      return;
    }
    if (
      step === 1 &&
      travelers.some((t) => t.name.trim().length < 3 || !t.passengerTypeId)
    ) {
      setError("Escribe el nombre completo y elige la tarifa de cada viajero.");
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  }
  async function pay(e) {
    e.preventDefault();
    if (busy) return;
    if (!user) {
      onLogin();
      return;
    }
    setBusy(true);
    setError("");
    try {
      let b = booking;
      if (!b) {
        const q = new Map();
        for (const t of travelers)
          q.set(t.passengerTypeId, (q.get(t.passengerTypeId) || 0) + 1);
        const payload = {
          tripId,
          channel: pos ? "pos" : "web",
          passengers: [...q].map(([id, quantity]) => ({ id, quantity })),
          travelers: travelers.map((t) => ({ ...t, name: t.name.trim() })),
          addons: Object.entries(extras)
            .filter(([, n]) => n > 0)
            .map(([id, quantity]) => ({ id, quantity })),
          ...(pos ? { customerId, cashSessionId: cashSession?.id } : {}),
        };
        const fingerprint = JSON.stringify(payload);
        if (attempt.current?.fingerprint !== fingerprint)
          attempt.current = { key: crypto.randomUUID(), fingerprint };
        b = await api("/bookings", {
          method: "POST",
          body: payload,
          key: attempt.current.key,
        });
        setBooking(b);
        if (!pos) sessionStorage.removeItem("conexiones-draft");
      }
      if (!pos) {
        if (b.isDemo || trip?.demo) {
          setBooking(
            await api(`/demo/bookings/${b.id}/pay`, {
              method: "POST",
              body: {},
            }),
          );
        } else {
          const p = await api(`/bookings/${b.id}/preference`, {
            method: "POST",
          });
          location.assign(p.checkout_url);
        }
      }
    } catch (e) {
      setError(e.message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  if (!catalog)
    return (
      <div className="box" role="status">
        {error || "Buscando tus próximas conexiones…"}
      </div>
    );
  if (booking?.status === "confirmed")
    return (
      <div className="box booking-success">
        <span className="success-icon">✓</span>
        <h2 className="title is-3">¡Tu viaje está confirmado!</h2>
        <p>
          El taxi se puede solicitar desde el boleto, cuando el cliente esté
          listo.
        </p>
        <a
          className="button is-primary mt-4"
          href={`/ticket/${booking.ticket_token}`}
        >
          Abrir boleto y solicitar auto
        </a>
        <button
          className="button mt-4 ml-3"
          onClick={() => {
            setBooking(null);
            attempt.current = null;
            setStep(0);
            setTrip("");
            setTravelers([{ name: "", passengerTypeId: "" }]);
            setCount(1);
            setExtras({});
          }}
        >
          Nueva venta
        </button>
      </div>
    );
  return (
    <section
      id="reservar"
      className={`reservation ${step > 0 ? "reservation-focused" : ""}`}
    >
      <ol className="booking-steps" aria-label="Etapas de tu reserva">
        {steps.map((label, i) => (
          <li
            key={label}
            aria-current={step === i ? "step" : undefined}
            className={step === i ? "current" : i < step ? "complete" : ""}
          >
            <span>{i < step ? "✓" : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <form className="box booking-box" onSubmit={step === 3 ? pay : advance}>
        <div className="booking-title">
          <div>
            <p className="eyebrow">
              {pos ? "TAQUILLA CONEXIONES" : "TU PRÓXIMA CONEXIÓN"}
            </p>
            <h2 ref={heading} tabIndex="-1">
              {
                [
                  "¿A dónde viajamos?",
                  "¿Quiénes van a viajar?",
                  "Haz más cómodo tu camino",
                  "Revisa y confirma tu viaje",
                ][step]
              }
            </h2>
          </div>
          <span className="step-caption">Paso {step + 1} de 4</span>
        </div>
        {step === 0 ? (
          <>
            <div className="search-grid">
              <label>
                Origen
                <div className="select is-fullwidth">
                  <select
                    aria-label="Origen"
                    value={origin}
                    onChange={(e) => {
                      setOrigin(e.target.value);
                      setDestination(
                        routes.find((r) => r.origin === e.target.value)
                          ?.destination || "",
                      );
                      setTrip("");
                    }}
                  >
                    {origins.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </div>
              </label>
              <button
                type="button"
                className="swap-route"
                aria-label="Intercambiar origen y destino"
                onClick={() => {
                  if (
                    routes.some(
                      (r) =>
                        r.origin === destination && r.destination === origin,
                    )
                  ) {
                    setOrigin(destination);
                    setDestination(origin);
                    setTrip("");
                  }
                }}
              >
                ⇄
              </button>
              <label>
                Destino
                <div className="select is-fullwidth">
                  <select
                    aria-label="Destino"
                    value={destination}
                    onChange={(e) => {
                      setDestination(e.target.value);
                      setTrip("");
                    }}
                  >
                    {destinations.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </div>
              </label>
              <label>
                Fecha de salida
                <input
                  aria-label="Fecha de salida"
                  className="input"
                  type="date"
                  required
                  min={day(Date.now())}
                  value={travelDate}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setTrip("");
                  }}
                />
              </label>
              <label>
                Pasajeros
                <div className="select is-fullwidth">
                  <select
                    aria-label="Pasajeros"
                    value={count}
                    onChange={(e) => changeCount(Number(e.target.value))}
                  >
                    {Array.from({ length: 60 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1} {i ? "pasajeros" : "pasajero"}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>
            <div className="departure-list">
              <div className="section-heading">
                <h3>Salidas disponibles</h3>
                <span>{travelDate}</span>
              </div>
              {departures.map((t) => (
                <label
                  key={t.id}
                  className={`departure-card ${tripId === t.id ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="departure"
                    value={t.id}
                    checked={tripId === t.id}
                    onChange={() => choose(t)}
                  />
                  <div className="departure-time">
                    <strong>{clock(t.departure_at)}</strong>
                    <span>Salida</span>
                  </div>
                  <div className="departure-journey">
                    <span>
                      {t.origin} <b>→</b> {t.destination}
                    </span>
                    <small>
                      {t.brand} {t.model} ·{" "}
                      {Math.round(
                        (new Date(t.arrival_at) - new Date(t.departure_at)) /
                          60000,
                      )}{" "}
                      min · {t.available} lugares {t.demo ? "· DEMO" : ""}
                    </small>
                  </div>
                  <div className="departure-time">
                    <strong>{clock(t.arrival_at)}</strong>
                    <span>Llegada estimada</span>
                  </div>
                  <span className="departure-price">
                    Desde{" "}
                    <strong>
                      {money(
                        Math.min(
                          ...catalog.fares
                            .filter((f) => f.route_id === t.route_id)
                            .map((f) => f.price_cents),
                        ),
                      )}
                    </strong>
                  </span>
                </label>
              ))}
              {!departures.length && (
                <div className="empty-departures">
                  <span>🚌</span>
                  <h4>Aún no hay salidas para esta búsqueda</h4>
                  <p>
                    Prueba otra fecha o comunícate con taquilla para consultar
                    disponibilidad.
                  </p>
                  {next && (
                    <button
                      className="button is-light mt-3"
                      type="button"
                      onClick={() => {
                        setDate(day(next.departure_at));
                        choose(next);
                      }}
                    >
                      Ver próxima salida · {date(next.departure_at)}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="wizard-actions">
              <p>Elige tu viaje. Después capturamos los nombres.</p>
              <button className="button is-primary" disabled={!tripId}>
                Continuar a pasajeros →
              </button>
            </div>
          </>
        ) : (
          <div className="wizard-grid">
            <div>
              {step === 1 && (
                <>
                  <p className="muted mb-4">
                    Captura el nombre de cada persona como aparece en su
                    identificación. La tarifa se aplica por viajero.
                  </p>
                  {travelers.map((t, i) => (
                    <div className="traveler-card" key={i}>
                      <h3>Pasajero {i + 1}</h3>
                      <div className="columns">
                        <div className="column">
                          <label className="label" htmlFor={`traveler-${i}`}>
                            Nombre completo
                          </label>
                          <input
                            id={`traveler-${i}`}
                            className="input"
                            autoComplete="off"
                            required
                            minLength="3"
                            maxLength="120"
                            placeholder="Nombre y apellidos"
                            value={t.name}
                            onChange={(e) =>
                              setTravelers((old) =>
                                old.map((p, j) =>
                                  j === i ? { ...p, name: e.target.value } : p,
                                ),
                              )
                            }
                          />
                        </div>
                        <div className="column">
                          <label className="label" htmlFor={`type-${i}`}>
                            Tipo de pasajero
                          </label>
                          <div className="select is-fullwidth">
                            <select
                              id={`type-${i}`}
                              required
                              value={t.passengerTypeId}
                              onChange={(e) =>
                                setTravelers((old) =>
                                  old.map((p, j) =>
                                    j === i
                                      ? {
                                          ...p,
                                          passengerTypeId: e.target.value,
                                        }
                                      : p,
                                  ),
                                )
                              }
                            >
                              {types.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ·{" "}
                                  {money(
                                    fares.find(
                                      (f) => f.passenger_type_id === p.id,
                                    ).price_cents,
                                  )}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {step === 2 && (
                <>
                  <p className="muted mb-4">
                    Los complementos son opcionales. Puedes continuar sin
                    agregar ninguno.
                  </p>
                  {catalog.addons.map((a) => (
                    <div className="extra-card" key={a.id}>
                      <span className="extra-icon" aria-hidden="true">
                        ☕
                      </span>
                      <div>
                        <h3>{a.name}</h3>
                        <p>{money(a.price_cents)} por complemento</p>
                      </div>
                      <label>
                        Cantidad
                        <input
                          aria-label={`Cantidad de ${a.name}`}
                          className="input count-input"
                          type="number"
                          min="0"
                          max="60"
                          value={extras[a.id] || 0}
                          onChange={(e) =>
                            setExtras({
                              ...extras,
                              [a.id]: Math.max(
                                0,
                                Math.min(60, Number(e.target.value)),
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                  {!catalog.addons.length && (
                    <p>No hay complementos disponibles por ahora.</p>
                  )}
                  <div className="later-taxi">
                    <span aria-hidden="true">🚕</span>
                    <div>
                      <h3>Tu auto al llegar, después del pago</h3>
                      <p>
                        Con el boleto confirmado podrás solicitar Viaje Rápido
                        desde Mis reservas. Decide tu zona y equipaje con calma.
                      </p>
                    </div>
                  </div>
                </>
              )}
              {step === 3 && (
                <>
                  <div className="review-card">
                    <h3>Pasajeros</h3>
                    {travelers.map((t, i) => (
                      <p key={i}>
                        <strong>{t.name}</strong>
                        <span>
                          {types.find((p) => p.id === t.passengerTypeId)?.name}{" "}
                          ·{" "}
                          {money(
                            fares.find(
                              (f) => f.passenger_type_id === t.passengerTypeId,
                            )?.price_cents || 0,
                          )}
                        </span>
                      </p>
                    ))}
                  </div>
                  <div className="review-card">
                    <h3>Complementos</h3>
                    {Object.values(extras).some((n) => n > 0) ? (
                      catalog.addons
                        .filter((a) => extras[a.id] > 0)
                        .map((a) => (
                          <p key={a.id}>
                            {extras[a.id]} × {a.name}
                            <span>{money(a.price_cents * extras[a.id])}</span>
                          </p>
                        ))
                    ) : (
                      <p>Sin complementos</p>
                    )}
                  </div>
                  {pos && (
                    <label className="label">
                      Cliente de la reserva
                      <div className="select is-fullwidth mt-2">
                        <select
                          required
                          value={customerId}
                          onChange={(e) => setCustomer(e.target.value)}
                        >
                          <option value="">Selecciona un cliente</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {c.email}
                            </option>
                          ))}
                        </select>
                      </div>
                    </label>
                  )}
                  {!pos && (
                    <div className="payment-note">
                      <strong>
                        {trip?.demo
                          ? "Pago de demostración"
                          : "Pago seguro con Mercado Pago"}
                      </strong>
                      <p>
                        Los lugares se apartan durante 15 minutos al iniciar el
                        pago, o hasta la salida si ocurre antes. El taxi se
                        solicita después.
                      </p>
                      {Boolean(trip?.demo) && (
                        <p className="notification is-warning is-light mt-3">
                          Este pago es simulado. No se cobra dinero. Ingresa con
                          Ana o Luis para probar la compra y el taxi.
                        </p>
                      )}
                      {!trip?.demo && !catalog.integrations?.payments && (
                        <p className="notification is-warning is-light mt-3">
                          El pago en línea estará disponible pronto. Puedes
                          comprar tu boleto en taquilla.
                        </p>
                      )}
                      {!user &&
                        (trip?.demo || catalog.integrations?.payments) && (
                          <button
                            type="button"
                            className="button is-light mt-3"
                            onClick={onLogin}
                          >
                            Ingresa o crea tu cuenta para pagar
                          </button>
                        )}
                    </div>
                  )}
                  {booking && (
                    <p className="notification is-warning is-light">
                      Tus lugares ya están apartados. Retoma el pago sin crear
                      otra reserva.{" "}
                      <a href={`/ticket/${booking.ticket_token}`}>
                        Ver reserva
                      </a>
                    </p>
                  )}
                </>
              )}
            </div>
            <aside className="summary">
              <p className="eyebrow">RESUMEN DE TU VIAJE</p>
              <h3>
                {trip?.origin}
                <br />
                <span>↓</span> {trip?.destination}
              </h3>
              {trip && (
                <p className="summary-date">
                  {date(trip.departure_at)}
                  <br />
                  {count} {count === 1 ? "pasajero" : "pasajeros"}
                </p>
              )}
              <div className="total-row">
                <span>Viaje</span>
                <strong>{money(base)}</strong>
              </div>
              <div className="total-row">
                <span>Complementos</span>
                <strong>{money(addonTotal)}</strong>
              </div>
              <div className="total-row">
                <span>
                  {pos ? "Comisión taquilla" : "Servicio web ($10 por persona)"}
                </span>
                <strong>{money(fee)}</strong>
              </div>
              <div className="total-row grand-total">
                <span>Total MXN</span>
                <strong>{money(base + addonTotal + fee)}</strong>
              </div>
              <p className="help">
                Reservas por capacidad, sin seleccionar asiento.
              </p>
            </aside>
            <div className="wizard-actions">
              <button
                type="button"
                className="button is-light"
                disabled={busy || Boolean(booking)}
                onClick={() => {
                  setError("");
                  setStep((s) => s - 1);
                }}
              >
                ← Regresar
              </button>
              <button
                className={`button is-primary ${busy ? "is-loading" : ""}`}
                disabled={
                  busy ||
                  (step === 3 &&
                    !pos &&
                    !trip?.demo &&
                    !catalog.integrations?.payments)
                }
              >
                {step === 3
                  ? pos
                    ? trip?.demo
                      ? "Confirmar venta DEMO"
                      : "Confirmar cobro en efectivo"
                    : trip?.demo
                      ? user
                        ? "Confirmar pago simulado"
                        : "Ingresar para probar"
                      : booking
                        ? "Continuar pago"
                        : user
                          ? "Ir al pago seguro"
                          : "Ingresar para pagar"
                  : step === 2
                    ? "Continuar al pago"
                    : "Continuar a extras"}{" "}
                →
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="notification is-danger is-light mt-4" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
