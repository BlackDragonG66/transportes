// Destinations are mapped explicitly; partial city names never grant coverage.
export const localCities = ["Morelia", "Apatzingán"];
const normalize = (value) =>
  String(value)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const destinations = new Map([
  ["morelia", "Morelia"],
  ["aeropuerto de morelia", "Morelia"],
  ["cree morelia", "Morelia"],
  ["teleton morelia", "Morelia"],
  ["apatzingan", "Apatzingán"],
]);
export function arrivalCity(destination) {
  return destinations.get(normalize(destination)) ?? null;
}
export function coversArrival(city, destination) {
  return localCities.some(
    (allowed) =>
      normalize(city) === normalize(allowed) &&
      allowed === arrivalCity(destination),
  );
}
