export const staffPaths = {
  driver: "/conductores",
  cashier: "/cajeros",
  admin: "/administracion",
};
export function staffArea(path) {
  return (
    {
      "/conductores": "drivers",
      "/cajeros": "cash",
      "/administracion": "admin",
    }[path.replace(/\/$/, "")] || null
  );
}
export function allowedArea(role, area) {
  return (
    role === "admin" ||
    (role === "driver" && area === "drivers") ||
    (role === "cashier" && area === "cash")
  );
}
export function staffSections(area, capabilities) {
  return [
    ...(area === "drivers" && capabilities.units
      ? [["unidades", "Mis salidas"]]
      : []),
    ...(area === "drivers" && capabilities.local
      ? [["taxi", "Taxi / Uber"]]
      : []),
    ...(area === "cash"
      ? [
          ["caja", "Mi caja"],
          ["ventas", "Vender boleto"],
          ["paqueteria", "Paquetería"],
          ["reportes", "Reportes y cortes"],
        ]
      : []),
    ...(area === "admin" ? [["gestion", "Administración"]] : []),
    ["avisos", "Mis avisos"],
    ["cuenta", "Mi cuenta"],
  ];
}
