import { KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { api, getStoredToken } from "../api/client";
import type { City, SettlementSearchResult } from "../types";

type CityComboboxProps = {
  cities?: City[];
  value: string;
  onChange: (cityId: string) => void;
  label?: string;
  onSuggest?: (name: string) => void;
};

export function CityCombobox({ cities = [], value, onChange, label = "Населённый пункт", onSuggest }: CityComboboxProps) {
  const inputId = useId();
  const listId = `${inputId}-options`;
  const selectedCity = cities.find((city) => city.id === value);
  const [query, setQuery] = useState(selectedCity?.name ?? "");
  const [options, setOptions] = useState<SettlementSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (selectedCity) setQuery(selectedCity.name);
  }, [selectedCity?.name]);

  useEffect(() => {
    const search = query.trim();
    if (search.length < 2 || selectedCity?.name === search) {
      setOptions([]);
      return;
    }
    const handle = window.setTimeout(() => {
      setIsLoading(true);
      setMessage("");
      api.searchSettlements(search)
        .then(setOptions)
        .catch(() => setMessage("Не удалось загрузить населённые пункты."))
        .finally(() => setIsLoading(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, selectedCity?.name]);

  const visibleOptions = useMemo(() => options.slice(0, 20), [options]);

  function selectOption(option: SettlementSearchResult) {
    onChange(option.id);
    setQuery(option.displayName);
    setIsOpen(false);
    setMessage("");
  }

  async function suggest() {
    if (!getStoredToken()) {
      if (onSuggest) {
        onSuggest(query.trim());
        setIsOpen(false);
        setMessage("Населённый пункт будет добавлен при регистрации и отправлен на проверку.");
        return;
      }
      setMessage("Новый населённый пункт можно предложить после входа в профиле.");
      return;
    }
    try {
      const result = await api.suggestSettlement({ name: query.trim() });
      selectOption(result.settlement);
      setMessage(result.existing ? "Найден существующий вариант." : "Населённый пункт отправлен на проверку.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось предложить населённый пункт.");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.min(current + 1, Math.max(visibleOptions.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && isOpen && visibleOptions[activeIndex]) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex]);
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div className="city-combobox">
      <label htmlFor={inputId}>{label}</label>
      <div className="city-combobox__control">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
            setActiveIndex(0);
            if (value) onChange("");
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Начните вводить город, посёлок или село"
          autoComplete="off"
        />
        <span className="city-combobox__chevron" aria-hidden="true">⌄</span>
      </div>
      {isOpen && query.trim().length >= 2 && (
        <div className="city-combobox__list" id={listId} role="listbox">
          {isLoading ? <p className="city-combobox__empty">Ищем...</p> : visibleOptions.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={`city-combobox__option${index === activeIndex ? " city-combobox__option--active" : ""}`}
              key={option.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
            >
              <span><strong>{option.name}</strong><small>{[option.region, option.district].filter(Boolean).join(", ")}</small></span>
              <em>{option.serviceStatus === "active" ? "Есть пользователи" : "Доступен для выбора"}</em>
            </button>
          ))}
          {!isLoading && visibleOptions.length === 0 && (
            <div className="city-combobox__empty">
              <p>Населённый пункт не найден.</p>
              <button className="link-button" type="button" onClick={suggest}>Предложить «{query.trim()}»</button>
            </div>
          )}
        </div>
      )}
      <span className="field-help">Поиск по названию и региону. Выберите подходящий вариант.</span>
      {message && <span className="field-help">{message}</span>}
    </div>
  );
}
