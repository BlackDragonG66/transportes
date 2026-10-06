import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "bulma/css/bulma.min.css";
import "./style.css";
import "./demo.css";
import { api, date, money, enablePush, disablePush } from "./api.js";
import ReservationForm from "./ReservationForm.jsx";
import BoardingView from "./BoardingView.jsx";
import { TaxiVerification } from "./StaffVehicles.jsx";
import StaffPortal from "./StaffPortal.jsx";
import { staffArea, staffPaths } from "./staff-routing.js";
import Account from "./Account.jsx";
import { Auth, Activate } from "./Auth.jsx";
import { HomeHero, HomeContent, SiteFooter } from "./HomeContent.jsx";
import useModalFocus from "./useModalFocus.js";
import Parcels, { ParcelTracking } from "./Parcels.jsx";
import { DemoGuide, Notices } from "./Demo.jsx";
function MyBookings() {
  const [rows, setRows] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    api("/bookings")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  const status = {
    pending: "Pago pendiente",
    confirmed: "Confirmado",
    expired: "Vencido",
    cancelled: "Cancelado",
    refunded: "Reembolsado",
    refund_required: "Reembolso pendiente",
  };
  return (
    <div className="box">
      <p className="eyebrow">TODAS TUS CONEXIONES</p>
      <h1 className="title">Mis reservas</h1>
      {error && <p>{error}</p>}
      {rows.map((b) => (
        <article className="booking-list-card" key={b.id}>
          <div>
            <h2>
              {b.origin} → {b.destination}
            </h2>
            <p>
              {date(b.departure_at)} · {b.passengers} pasajeros
            </p>
            <span className="tag is-light">{status[b.status]}</span>
          </div>
          <div>
            <strong>{money(b.total_cents)}</strong>
            <div className="buttons mt-3">
              <a
                className="button is-primary is-small"
                href={`/ticket/${b.ticket_token}`}
              >
                Ver boleto
              </a>
              {b.status === "confirmed" && (
                <a
                  className="button is-light is-small"
                  href={`/ticket/${b.ticket_token}#taxi`}
                >
                  Mi auto al llegar
                </a>
              )}
            </div>
          </div>
        </article>
      ))}
      {!rows.length && !error && (
        <p>Aún no tienes reservas. Tu próxima conexión te espera.</p>
      )}
    </div>
  );
}
function App() {
  const [demo, setDemo] = useState(null);
  const [user, setUser] = useState(null),
    [loaded, setLoaded] = useState(false),
    [tab, setTab] = useState(
      [
        "admin",
        "bookings",
        "pos",
        "operations",
        "account",
        "parcels",
        "notices",
      ].includes(location.hash.slice(1))
        ? location.hash.slice(1)
        : "reserve",
    ),
    [message, setMessage] = useState(""),
    [site, setSite] = useState(null),
    [siteError, setSiteError] = useState(""),
    [stage, setStage] = useState(0),
    [login, setLogin] = useState(false),
    [menu, setMenu] = useState(false);
  const loadSite = () =>
    api("/site")
      .then(setSite)
      .catch((e) => setSiteError(e.message));
  useModalFocus(login, () => setLogin(false));
  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoaded(true));
    loadSite();
    api("/demo/status")
      .then(setDemo)
      .catch(() => {});
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    const update = () => {
      const value = location.hash.slice(1);
      if (
        [
          "admin",
          "bookings",
          "pos",
          "operations",
          "account",
          "parcels",
          "notices",
        ].includes(value)
      )
        setTab(value);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!login) return;
    const close = (e) => {
      if (e.key === "Escape") setLogin(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [login]);
  const match = location.pathname.match(
      /^\/(ticket|vehicle|tracking|parcel-tracking|taxi)\/([a-f0-9-]+)$/i,
    ),
    activation = location.pathname.match(/^\/activate\/([a-f0-9]{64})$/),
    requiresAuth = match?.[1] === "ticket";
  const settings = site?.settings,
    home = !match && !activation && tab === "reserve";
  useEffect(() => {
    if (
      loaded &&
      user &&
      staffPaths[user.role] &&
      !match &&
      !activation &&
      !new URLSearchParams(location.search).has("pasajeros")
    )
      location.replace(staffPaths[user.role]);
  }, [loaded, user?.id]);
  function go(value) {
    setTab(value);
    setMenu(false);
    history.replaceState(null, "", value === "reserve" ? "/" : `/#${value}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function logout() {
    try {
      await disablePush();
      await api("/auth/logout", { method: "POST" });
      sessionStorage.removeItem("conexiones-draft");
      setUser(null);
      go("reserve");
    } catch (e) {
      setMessage(e.message);
    }
  }
  return (
    <>
      {settings && (
        <div className="announcement-bar">
          <span>{settings.announcement}</span>
          <a href={`tel:${settings.phones[0]}`}>
            Atención a viajeros · {settings.phones[0]}
          </a>
        </div>
      )}
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/">
            {settings && (
              <img
                className="brand-logo"
                src={settings.logoUrl}
                alt="Logo de ConexionES"
              />
            )}
            <span>
              Conexion<b>ES</b>
              <small>VIAJES QUE NOS ACERCAN</small>
            </span>
          </a>
          <nav
            className={`main-nav ${menu ? "open" : ""}`}
            aria-label="Navegación principal"
          >
            <a
              href="/#reservar"
              onClick={() => {
                if (!match) go("reserve");
              }}
            >
              Comprar boleto
            </a>
            <a href="/#promociones">Promociones</a>
            <a
              href="/#parcels"
              onClick={(e) => {
                if (!match) {
                  e.preventDefault();
                  go("parcels");
                }
              }}
            >
              Paquetería
            </a>
            <a href="/#servicios">Nuestros servicios</a>
            <a href="/#contacto">Contacto</a>
          </nav>
          <div className="header-actions">
            {user ? (
              <>
                <button
                  className="button is-light is-small"
                  onClick={() => go("bookings")}
                >
                  Mis viajes
                </button>
                <button className="button is-text is-small" onClick={logout}>
                  Salir
                </button>
              </>
            ) : (
              <button
                className="button is-primary is-small"
                onClick={() => setLogin(true)}
              >
                Ingresar
              </button>
            )}
            <button
              className="mobile-menu"
              aria-label="Abrir menú"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              ☰
            </button>
          </div>
        </div>
      </header>
      {demo?.enabled && (
        <div className="demo-banner">
          <strong>DEMONSTRACIÓN</strong>
          <span>
            Salidas y cobros de ejemplo · Ningún pago DEMO realiza un cargo
          </span>
        </div>
      )}
      {home && stage === 0 && settings && <HomeHero settings={settings} />}
      <main
        className={`page-container ${home && stage === 0 ? "home-container" : ""}`}
      >
        {user && !match && (
          <nav className="workspace-tabs" aria-label="Panel personal">
            {[
              ["reserve", "Reservar"],
              ["bookings", "Mis reservas"],
              ["parcels", "Paquetería"],
              ["notices", "Mis avisos"],
              ["account", "Mi cuenta"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => go(id)}
              >
                {label}
              </button>
            ))}
            {staffPaths[user.role] && (
              <a className="button is-light" href={staffPaths[user.role]}>
                Mi espacio de trabajo
              </a>
            )}
            <button
              className="push-button"
              onClick={async () => {
                try {
                  await enablePush();
                  setMessage("Notificaciones activadas.");
                } catch (e) {
                  setMessage(e.message);
                }
              }}
            >
              Activar avisos
            </button>
          </nav>
        )}
        {!match && <DemoGuide user={user} />}
        {match && user && staffPaths[user.role] && (
          <a className="button is-light mb-4" href={staffPaths[user.role]}>
            Volver a mi espacio de trabajo
          </a>
        )}
        {message && (
          <p className="notification" role="status">
            {message}
            <button
              aria-label="Cerrar aviso"
              className="delete"
              onClick={() => setMessage("")}
            />
          </p>
        )}
        {!loaded ? (
          <p>Cargando…</p>
        ) : activation ? (
          <Activate
            token={activation[1]}
            onUser={(u) => {
              history.replaceState(null, "", "/");
              setUser(u);
            }}
          />
        ) : match?.[1] === "parcel-tracking" ? (
          <ParcelTracking token={match[2]} />
        ) : match?.[1] === "taxi" ? (
          <TaxiVerification token={match[2]} />
        ) : match ? (
          requiresAuth && !user ? (
            <Auth onUser={setUser} />
          ) : (
            <BoardingView mode={match[1]} token={match[2]} user={user} />
          )
        ) : !user && tab !== "reserve" ? (
          <Auth onUser={setUser} />
        ) : tab === "account" && user ? (
          <Account user={user} />
        ) : tab === "bookings" && user ? (
          <MyBookings />
        ) : tab === "parcels" && user ? (
          <Parcels user={user} />
        ) : tab === "notices" && user ? (
          <Notices key={user.id} />
        ) : (
          <>
            <ReservationForm
              user={user}
              onLogin={() => setLogin(true)}
              onStageChange={setStage}
            />
            {site && stage === 0 && <HomeContent site={site} />}
          </>
        )}
        {siteError && !site && (
          <p className="notification is-warning">{siteError}</p>
        )}
      </main>
      {settings && <SiteFooter settings={settings} />}
      {login && (
        <div
          className="modal is-active"
          role="dialog"
          aria-modal="true"
          aria-label="Acceso a ConexionES"
        >
          <div className="modal-background" onClick={() => setLogin(false)} />
          <div className="modal-content">
            <Auth
              onUser={(u) => {
                setUser(u);
                setLogin(false);
              }}
            />
          </div>
          <button
            autoFocus
            className="modal-close is-large"
            aria-label="Cerrar acceso"
            onClick={() => setLogin(false)}
          />
        </div>
      )}
    </>
  );
}
let area = staffArea(location.pathname);
const legacyAreas = { operations: "drivers", pos: "cash", admin: "admin" };
if (location.pathname === "/" && legacyAreas[location.hash.slice(1)]) {
  area = legacyAreas[location.hash.slice(1)];
  history.replaceState(
    null,
    "",
    { drivers: "/conductores", cash: "/cajeros", admin: "/administracion" }[
      area
    ],
  );
}
createRoot(document.getElementById("root")).render(
  area ? <StaffPortal area={area} /> : <App />,
);
