import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { effectiveRoleForUser } from "../utils/authRole";
import type { MyCities } from "../types";
import { CityCombobox } from "./CityCombobox";

export function UserCitiesPanel() {
  const { bootstrap, user, refreshMe } = useAuth();
  const [data, setData] = useState<MyCities | null>(null);
  const [cityId, setCityId] = useState("");
  const [message, setMessage] = useState("");
  const roleScope = effectiveRoleForUser(user) === "performer" ? "helper" : "customer";

  async function load() {
    setData(await api.myCities());
  }

  useEffect(() => { load().catch(() => setMessage("Не удалось загрузить города профиля.")); }, []);

  async function addCity() {
    if (!cityId) return setMessage("Выберите населённый пункт.");
    try {
      await api.addMyCity({ cityId, roleScope });
      setCityId("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось добавить город.");
    }
  }

  async function makePrimary(id: string) {
    await api.updateMyCity(id, { isPrimary: true });
    await Promise.all([load(), refreshMe()]);
  }

  async function remove(id: string) {
    await api.deleteMyCity(id);
    await load();
  }

  return (
    <section className="plain-section span-2">
      <h2>Города</h2>
      <p>Вы можете добавить соседние города, если готовы помогать или создавать заявки там. Если вы переехали, измените основной город.</p>
      <h3>Основной город</h3>
      <p><strong>{data?.primaryCity?.city.name ?? "Не выбран"}</strong>{data?.primaryCity?.city.region ? `, ${data.primaryCity.city.region}` : ""}</p>
      <h3>Дополнительные города</h3>
      {data?.additionalCities.length ? data.additionalCities.map((row) => (
        <div className="data-row" key={row.id}>
          <strong>{row.city.name}</strong><span>{row.city.region}</span>
          <button className="secondary-button" type="button" onClick={() => makePrimary(row.id)}>Сделать основным</button>
          <button className="secondary-button" type="button" onClick={() => remove(row.id)}>Удалить</button>
        </div>
      )) : <p className="empty-text">Дополнительных городов пока нет.</p>}
      <div className="form-inline">
        <CityCombobox cities={bootstrap?.cities ?? []} value={cityId} onChange={setCityId} label="Добавить населённый пункт" />
        <button className="primary-button" type="button" onClick={addCity}>Добавить город</button>
      </div>
      {message && <p className="notice">{message}</p>}
    </section>
  );
}
