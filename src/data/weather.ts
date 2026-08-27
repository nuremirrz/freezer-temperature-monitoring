export interface WeatherInfo {
  temp: number; // °F
  code: number;
  fetchedAt: number;
}

export interface WeatherText {
  label: string;
  icon: "sun" | "sun-cloud" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";
}

/** WMO weather code → label + icon bucket */
export function describeWeather(code: number): WeatherText {
  if (code === 0) return { label: "Clear Sky", icon: "sun" };
  if (code === 1) return { label: "Mainly Clear", icon: "sun-cloud" };
  if (code === 2) return { label: "Partly Cloudy", icon: "sun-cloud" };
  if (code === 3) return { label: "Overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "fog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "drizzle" };
  if (code >= 61 && code <= 67) return { label: "Rain", icon: "rain" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "snow" };
  if (code >= 80 && code <= 82) return { label: "Rain Showers", icon: "rain" };
  if (code === 85 || code === 86) return { label: "Snow Showers", icon: "snow" };
  if (code >= 95) return { label: "Thunderstorm", icon: "storm" };
  return { label: "Cloudy", icon: "cloud" };
}

const CACHE_TTL = 12 * 60_000; // 12 minutes
const cache = new Map<string, WeatherInfo | "error">();

export async function fetchWeather(
  lat: number,
  lng: number,
): Promise<WeatherInfo | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit === "error") return null;
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL) return hit;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const info: WeatherInfo = {
      temp: Math.round(json.current.temperature_2m),
      code: json.current.weather_code,
      fetchedAt: Date.now(),
    };
    cache.set(key, info);
    return info;
  } catch {
    cache.set(key, "error");
    setTimeout(() => cache.delete(key), 60_000);
    return null;
  }
}
