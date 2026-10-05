import { useEffect, useState } from "react";
import { api, enablePush, disablePush } from "./api.js";
import { Auth } from "./Auth.jsx";
import Account from "./Account.jsx";
import POS from "./POS.jsx";
import UnitOperations, { LocalOperations } from "./Operations.jsx";
import Parcels from "./Parcels.jsx";
import Admin from "./Admin.jsx";
import { Notices } from "./Demo.jsx";
import { allowedArea, staffPaths, staffSections } from "./staff-routing.js";
import "./staff.css";
const titles = {
  drivers: "Portal de conductores",
  cash: "Portal de cajeros",
  admin: "Administración",
};
export default function StaffPortal({ area }) {
  const [user, setUser] = useState(null),
    [loaded, setLoaded] = useState(false),
    [profile, setProfile] = useState(null),
    [site, setSite] = useState(null),
    [section, setSection] = useState(location.hash.slice(1)),
    [error, setError] = useState("");
  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoaded(true));
    api("/site")
      .then(setSite)
      .catch(() => {});
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const update = () => setSection(location.hash.slice(1));
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  useEffect(() => {
    setProfile(null);
    setError("");
    if (!user || !allowedArea(user.role, area)) return;
    let active = true;
    api("/staff/profile")
      .then((p) => {
        if (active) setProfile(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [user?.id, area]);
  async function logout() {
    try {
      await disablePush();
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setProfile(null);
      setSection("");
      history.replaceState(null, "", location.pathname);
    } catch (e) {
      setError(e.message);
    }
  }
  const sections = profile ? staffSections(area, profile.capabilities) : [],
    current = sections.some(([key]) => key === section)
      ? section
      : sections[0]?.[0];
  function go(key) {
    history.pushState(null, "", `${location.pathname}#${key}`);
    setSection(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return (
    <div className="staff-portal">
      <header className="staff-header">
        <div className="staff-header-inner">
          <a className="brand" href={location.pathname}>
            {site?.settings.logoUrl && (
              <img
                className="brand-logo"
                src={site.settings.logoUrl}
                alt="Logo de ConexionES"
              />
            )}
            <span>
              Conexion<b>ES</b>
              <small>{titles[area]}</small>
            </span>
          </a>
          <div className="staff-header-actions">
            <a href="/?pasajeros=1">Ver sitio de pasajeros</a>
            {user && (
              <button className="button is-light is-small" onClick={logout}>
                Salir
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="staff-container">
        {!loaded ? (
          <p role="status">Comprobando acceso…</p>
        ) : !user ? (
          <div className="staff-login">
            <p className="eyebrow">ACCESO DEL EQUIPO</p>
            <h1 className="title">{titles[area]}</h1>
            <p className="mb-5">
              Usa el correo y contraseña que te asignó el administrador.
            </p>
            <Auth
              loginOnly
              title="Ingresa a tu espacio de trabajo"
              onUser={setUser}
            />
            <div className="staff-entry-links">
              <a href="/conductores">Conductores</a>
              <a href="/cajeros">Cajeros</a>
              <a href="/administracion">Administradores</a>
            </div>
          </div>
        ) : !allowedArea(user.role, area) ? (
          <div className="box">
            <h1 className="title">Este acceso corresponde a otro perfil</h1>
            <p>La cuenta de {user.name} no tiene permisos para este panel.</p>
            <div className="buttons mt-4">
              <a
                className="button is-primary"
                href={staffPaths[user.role] || "/#bookings"}
              >
                Ir a mi panel
              </a>
              <button className="button" onClick={logout}>
                Cambiar de cuenta
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="staff-welcome">
              <div>
                <p className="eyebrow">
                  {user.role === "admin" ? "SUPERVISIÓN" : "ESPACIO DE TRABAJO"}
                </p>
                <h1 className="title">{titles[area]}</h1>
                <p>
                  {user.name} · {user.email}
                </p>
              </div>
              {Boolean(user.demo) && (
                <span className="tag is-warning is-medium">
                  DEMO · Sin cobros reales
                </span>
              )}
            </div>
            {profile && (
              <nav className="staff-tabs" aria-label="Panel de trabajo">
                {sections.map(([key, label]) => (
                  <a
                    href={`#${key}`}
                    key={key}
                    aria-current={current === key ? "page" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      go(key);
                    }}
                  >
                    {label}
                  </a>
                ))}
              </nav>
            )}
            {user.role === "admin" && (
              <nav
                className="staff-entry-links mb-5"
                aria-label="Supervisión del equipo"
              >
                <a href="/administracion">Administración</a>
                <a href="/conductores">Conductores y taxis</a>
                <a href="/cajeros">Cajas y ventas</a>
              </nav>
            )}
            {!profile && !error && (
              <p role="status">Cargando tus asignaciones…</p>
            )}
            {profile &&
              area === "drivers" &&
              !profile.capabilities.units &&
              !profile.capabilities.local && (
                <p className="notification is-warning">
                  Tu cuenta todavía no tiene un conductor o vehículo activo.
                  Solicita al administrador que complete tu asignación.
                </p>
              )}
            {profile && current === "unidades" && (
              <UnitOperations user={user} />
            )}
            {profile && current === "taxi" && <LocalOperations user={user} />}
            {profile && ["caja", "ventas", "reportes"].includes(current) && (
              <POS user={user} view={current} onNavigate={go} />
            )}
            {profile && current === "paqueteria" && <Parcels user={user} />}
            {profile && current === "gestion" && (
              <Admin onChanged={() => api("/site").then(setSite)} />
            )}
            {profile && current === "avisos" && (
              <>
                <div className="staff-notices-action">
                  <button
                    className="button is-light"
                    onClick={async () => {
                      try {
                        await enablePush();
                        setError("Avisos activados.");
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Activar avisos en este dispositivo
                  </button>
                </div>
                <Notices key={user.id} />
              </>
            )}
            {profile && current === "cuenta" && <Account user={user} />}
          </>
        )}
        {error && (
          <p className="notification mt-4" role="alert">
            {error}
          </p>
        )}
      </main>
      <footer className="staff-footer">
        ConexionES · Trabajo del equipo · <a href="/conductores">Conductores</a>{" "}
        · <a href="/cajeros">Cajeros</a>
      </footer>
    </div>
  );
}
