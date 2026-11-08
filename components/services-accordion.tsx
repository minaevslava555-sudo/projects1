"use client";

import { ServicesSkeleton } from "@/components/ui/loading";
import { useEffect, useId, useState } from "react";

export type ServiceCard = {
  id: number;
  slug: string;
  title: string;
  description: string;
  price_note: string;
};

type ServicesAccordionProps = {
  onPick?: (service: ServiceCard) => void;
};

export default function ServicesAccordion({ onPick }: ServicesAccordionProps) {
  const baseId = useId();
  const [services, setServices] = useState<ServiceCard[]>([]);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/services")
      .then(async (res) => {
        const data = (await res.json()) as { services?: ServiceCard[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Не удалось загрузить услуги");
        if (!cancelled) {
          setServices(data.services ?? []);
          setError("");
        }
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(slug: string) {
    setOpenSlug((current) => (current === slug ? null : slug));
  }

  if (loading) {
    return (
      <div className="services-accordion" aria-busy="true">
        <span className="sr-only">Загрузка услуг</span>
        <ServicesSkeleton count={3} />
      </div>
    );
  }

  if (error) {
    return <p className="services-status services-status-error">{error}</p>;
  }

  if (!services.length) {
    return null;
  }

  return (
    <div className="services-accordion" role="list">
      {services.map((service, index) => {
        const open = openSlug === service.slug;
        const panelId = `${baseId}-panel-${service.slug}`;
        const buttonId = `${baseId}-btn-${service.slug}`;
        return (
          <div
            key={service.slug}
            className={`services-item${open ? " is-open" : ""}`}
            role="listitem"
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <button
              type="button"
              id={buttonId}
              className="services-trigger"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(service.slug)}
            >
              <span className="services-trigger-text">
                <span className="services-title">{service.title}</span>
                <span className="services-price">{service.price_note}</span>
              </span>
              <span className="services-chevron" aria-hidden="true" />
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className="services-panel"
              aria-hidden={!open}
            >
              <div className="services-panel-inner">
                <p className="services-description">{service.description}</p>
                <p className="services-price-block">
                  <span className="services-price-label">Цена</span>
                  <span className="services-price-value">{service.price_note}</span>
                </p>
                {onPick ? (
                  <button
                    type="button"
                    className="services-pick"
                    tabIndex={open ? 0 : -1}
                    onClick={() => onPick(service)}
                  >
                    Выбрать услугу
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
